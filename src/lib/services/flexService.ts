import {
  countBySource,
  deleteMissingSyncedPositions,
  upsertPositions,
  type NewPosition,
} from '@/lib/repositories/positionRepo'

/**
 * IBKR Flex Web Service — free, token-based, no gateway process required.
 *
 * Two-step protocol:
 *   1. SendRequest  → returns a ReferenceCode and the GetStatement base URL
 *   2. GetStatement → returns the statement XML, or error 1019 while the
 *      report is still being generated (poll until it is ready)
 *
 * Setup (one time, in IBKR Client Portal):
 *   - Performance & Reports → Flex Queries → create a query with the
 *     "Open Positions" section, XML format, period "Last Business Day"
 *   - Settings → Account Settings → Flex Web Service → generate a token
 */

const BROKER = 'ibkr'
const SEND_REQUEST_URL =
  'https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest'

// IBKR asks for an identifiable User-Agent; requests without one can be blocked.
const USER_AGENT = 'ProjectStein/2.0 (portfolio sync)'

// Poll schedule for error 1019 ("statement generation in progress").
// Cumulative wait ~43s, inside the route's maxDuration of 60.
const POLL_DELAYS_MS = [3000, 5000, 5000, 10000, 10000, 10000]

// Error 1018 is throttling — back off once, hard.
const THROTTLE_DELAY_MS = 30000

/** Only equity positions feed the briefs; anything else is logged and skipped. */
const SYNCED_ASSET_CLASSES = new Set(['STK'])

export type FlexPosition = {
  ticker_symbol: string
  quantity: number
  avg_cost: number | null
  currency: string
  market_value: number | null
  unrealized_pnl: number | null
  asset_class: string | null
  as_of: string | null
}

export type FlexSyncResult = {
  ok: boolean
  reason?: string
  upserted: number
  deleted: number
  skipped: number
  as_of: string | null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ── Minimal XML helpers ──────────────────────────────────────────────────────
// Flex position XML is flat and attribute-only (<OpenPosition symbol="AAPL" …/>),
// so a full XML parser would be a dependency with nothing to do.

function tagText(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i').exec(xml)
  return match ? match[1].trim() : null
}

function parseAttrs(fragment: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const re = /([A-Za-z_][\w.-]*)\s*=\s*"([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(fragment)) !== null) {
    attrs[m[1]] = m[2]
  }
  return attrs
}

function num(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** IBKR reports dates as YYYYMMDD; convert to an ISO timestamp. */
function parseReportDate(value: string | undefined): string | null {
  if (!value) return null
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(value.trim())
  if (!m) return null
  return `${m[1]}-${m[2]}-${m[3]}T00:00:00Z`
}

function assertNoFlexError(xml: string, stage: string): void {
  const code = tagText(xml, 'ErrorCode')
  if (!code) return
  const message = tagText(xml, 'ErrorMessage') ?? 'unknown error'
  throw new FlexError(Number(code), `Flex ${stage} error ${code}: ${message}`)
}

export class FlexError extends Error {
  constructor(public code: number, message: string) {
    super(message)
    this.name = 'FlexError'
  }
}

// ── Protocol ─────────────────────────────────────────────────────────────────

async function flexFetch(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/xml,text/xml,*/*' },
  })
  if (!res.ok) {
    throw new Error(`Flex HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  }
  return res.text()
}

async function sendRequest(
  token: string,
  queryId: string
): Promise<{ referenceCode: string; statementUrl: string }> {
  const url = `${SEND_REQUEST_URL}?t=${encodeURIComponent(token)}&q=${encodeURIComponent(queryId)}&v=3`
  const xml = await flexFetch(url)
  assertNoFlexError(xml, 'SendRequest')

  const referenceCode = tagText(xml, 'ReferenceCode')
  const statementUrl = tagText(xml, 'Url')
  if (!referenceCode || !statementUrl) {
    throw new Error(`Flex SendRequest returned no reference code: ${xml.slice(0, 200)}`)
  }
  return { referenceCode, statementUrl }
}

async function getStatement(
  statementUrl: string,
  referenceCode: string,
  token: string
): Promise<string> {
  const url = `${statementUrl}?q=${encodeURIComponent(referenceCode)}&t=${encodeURIComponent(token)}&v=3`

  let throttled = false

  for (let attempt = 0; attempt <= POLL_DELAYS_MS.length; attempt++) {
    const xml = await flexFetch(url)

    try {
      assertNoFlexError(xml, 'GetStatement')
      return xml
    } catch (err) {
      if (!(err instanceof FlexError)) throw err

      // 1019 — still generating. Wait and retry.
      if (err.code === 1019 && attempt < POLL_DELAYS_MS.length) {
        await sleep(POLL_DELAYS_MS[attempt])
        continue
      }

      // 1018 — throttled. One long back-off, then give the loop another go.
      if (err.code === 1018 && !throttled) {
        throttled = true
        await sleep(THROTTLE_DELAY_MS)
        continue
      }

      throw err
    }
  }

  throw new Error('Flex statement not ready after polling; try again next cycle')
}

// ── Parsing ──────────────────────────────────────────────────────────────────

export function parseOpenPositions(xml: string): {
  positions: FlexPosition[]
  skipped: number
} {
  const byTicker = new Map<string, FlexPosition>()
  let skipped = 0

  const re = /<OpenPosition\b([^>]*?)\/?>/g
  let m: RegExpExecArray | null

  while ((m = re.exec(xml)) !== null) {
    const a = parseAttrs(m[1])
    const symbol = (a.symbol ?? '').toUpperCase().trim()
    if (!symbol) continue

    const assetClass = a.assetCategory ?? null
    if (assetClass && !SYNCED_ASSET_CLASSES.has(assetClass)) {
      skipped++
      continue
    }

    const quantity = num(a.position) ?? 0
    if (quantity === 0) continue // closed lot

    const existing = byTicker.get(symbol)
    if (existing) {
      // Same symbol across multiple lots — sum the quantities and money columns.
      const totalQty = existing.quantity + quantity
      byTicker.set(symbol, {
        ...existing,
        quantity: totalQty,
        market_value: (existing.market_value ?? 0) + (num(a.positionValue) ?? 0),
        unrealized_pnl: (existing.unrealized_pnl ?? 0) + (num(a.fifoPnlUnrealized) ?? 0),
        // Weighted average cost across lots; falls back to whichever side has data.
        avg_cost:
          existing.avg_cost !== null && num(a.costBasisPrice) !== null && totalQty !== 0
            ? (existing.avg_cost * existing.quantity + num(a.costBasisPrice)! * quantity) / totalQty
            : (existing.avg_cost ?? num(a.costBasisPrice)),
      })
      continue
    }

    byTicker.set(symbol, {
      ticker_symbol: symbol,
      quantity,
      avg_cost: num(a.costBasisPrice),
      currency: a.currency ?? 'USD',
      market_value: num(a.positionValue),
      unrealized_pnl: num(a.fifoPnlUnrealized),
      asset_class: assetClass,
      as_of: parseReportDate(a.reportDate),
    })
  }

  return { positions: [...byTicker.values()], skipped }
}

// ── Main export ──────────────────────────────────────────────────────────────

export async function syncPositions(): Promise<FlexSyncResult> {
  const token = process.env.IBKR_FLEX_TOKEN
  const queryId = process.env.IBKR_FLEX_QUERY_ID
  if (!token || !queryId) {
    throw new Error('IBKR_FLEX_TOKEN and IBKR_FLEX_QUERY_ID must be set')
  }

  const { referenceCode, statementUrl } = await sendRequest(token, queryId)
  const xml = await getStatement(statementUrl, referenceCode, token)
  const { positions, skipped } = parseOpenPositions(xml)

  // Guard: a truncated or empty statement must never wipe a real portfolio.
  // Deleting everything would leave the brief model reasoning about no holdings
  // at all, which is far worse than one stale sync.
  if (positions.length === 0) {
    const existing = await countBySource(BROKER, 'flex')
    if (existing > 0) {
      console.warn(
        `[flex] statement parsed to 0 positions while ${existing} synced rows exist — aborting`
      )
      return {
        ok: false,
        reason: 'empty_statement_guard',
        upserted: 0,
        deleted: 0,
        skipped,
        as_of: null,
      }
    }
  }

  const asOf = positions.find((p) => p.as_of !== null)?.as_of ?? null

  const rows: NewPosition[] = positions.map((p) => ({
    broker: BROKER,
    ticker_symbol: p.ticker_symbol,
    quantity: p.quantity,
    avg_cost: p.avg_cost,
    currency: p.currency,
    market_value: p.market_value,
    unrealized_pnl: p.unrealized_pnl,
    asset_class: p.asset_class,
    source: 'flex' as const,
    as_of: p.as_of,
  }))

  const upserted = await upsertPositions(rows)
  const deleted = await deleteMissingSyncedPositions(
    BROKER,
    'flex',
    rows.map((r) => r.ticker_symbol)
  )

  console.log(
    `[flex] synced ${upserted} positions (${deleted} closed, ${skipped} non-equity skipped) as_of=${asOf}`
  )

  return { ok: true, upserted, deleted, skipped, as_of: asOf }
}
