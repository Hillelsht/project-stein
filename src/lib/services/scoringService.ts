import { isTradingDay, toDateKey } from '@/lib/marketCalendar'
import {
  applyPricing,
  getOpenRecommendations,
  getRecommendationHistory,
  type Recommendation,
  type RecStatus,
} from '@/lib/repositories/recommendationRepo'
import { getLastClose } from '@/lib/services/marketDataService'

/**
 * The accountability loop.
 *
 * Every open recommendation is priced nightly against its entry and against
 * SPY, then auto-closed when its invalidation is breached or its horizon runs
 * out. This is what turns "the model said buy MSFT" into a number the owner can
 * judge the whole system by.
 */

const BENCHMARK = 'SPY'
const PACING_MS = 300

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function round(value: number | null, dp = 2): number | null {
  if (value === null || !Number.isFinite(value)) return null
  const f = 10 ** dp
  return Math.round(value * f) / f
}

/** Return in the direction of the trade: a SHORT that falls is a gain. */
export function directionalReturn(
  entry: number | null,
  current: number | null,
  direction: 'LONG' | 'SHORT'
): number | null {
  if (entry === null || current === null || entry === 0) return null
  const raw = ((current - entry) / entry) * 100
  return round(direction === 'SHORT' ? -raw : raw)
}

/**
 * Close-based invalidation: a LONG breaks when the *close* is at or below its
 * stop. Intraday wicks are deliberately ignored — free EOD data has no reliable
 * intraday series, and closing on a wick that fully recovered would score trades
 * the owner would never actually have been stopped out of.
 */
export function isInvalidated(rec: Recommendation, close: number): boolean {
  return rec.direction === 'LONG'
    ? close <= rec.invalidation_price
    : close >= rec.invalidation_price
}

export function isPastHorizon(rec: Recommendation, today = new Date()): boolean {
  return toDateKey(today) >= rec.horizon_date
}

export type ScoringSummary = {
  ok: boolean
  considered: number
  priced: number
  closed: number
  skipped: number
  by_status: Partial<Record<RecStatus, number>>
}

export async function scoreOpenRecommendations(now = new Date()): Promise<ScoringSummary> {
  const open = await getOpenRecommendations()
  const summary: ScoringSummary = {
    ok: true,
    considered: open.length,
    priced: 0,
    closed: 0,
    skipped: 0,
    by_status: {},
  }

  if (open.length === 0) return summary

  const benchmarkClose = await getLastClose(BENCHMARK)
  await sleep(PACING_MS)

  // One fetch per distinct ticker, not per recommendation.
  const tickers = [...new Set(open.map((r) => r.ticker_symbol))]
  const closes = new Map<string, number | null>()
  for (const ticker of tickers) {
    closes.set(ticker, await getLastClose(ticker))
    await sleep(PACING_MS)
  }

  const nowIso = now.toISOString()

  for (const rec of open) {
    const close = closes.get(rec.ticker_symbol) ?? null
    if (close === null) {
      // No price today — leave the row untouched so a data outage cannot
      // silently close a trade or freeze a stale return as final.
      console.warn(`[scoring] no close for ${rec.ticker_symbol}, skipping ${rec.id.slice(0, 8)}`)
      summary.skipped++
      continue
    }

    const currentReturn = directionalReturn(rec.entry_price, close, rec.direction)
    const benchmarkReturn = directionalReturn(rec.benchmark_entry_price, benchmarkClose, 'LONG')

    let status: RecStatus | undefined
    let closeNote: string | undefined

    if (isInvalidated(rec, close)) {
      status = 'CLOSED_INVALIDATED'
      closeNote = `Close ${close} breached invalidation ${rec.invalidation_price}.`
    } else if (isPastHorizon(rec, now)) {
      status = 'CLOSED_HORIZON'
      closeNote = `Reached ${rec.horizon_trading_days}-day horizon on ${rec.horizon_date}.`
    }

    await applyPricing(rec.id, {
      current_price: close,
      current_return_pct: currentReturn,
      benchmark_return_pct: benchmarkReturn,
      last_priced_at: nowIso,
      ...(status
        ? { status, closed_at: nowIso, close_price: close, close_note: closeNote }
        : {}),
    })

    summary.priced++
    if (status) {
      summary.closed++
      summary.by_status[status] = (summary.by_status[status] ?? 0) + 1
    }
  }

  console.log(
    `[scoring] priced ${summary.priced}/${summary.considered}, closed ${summary.closed}` +
      (summary.skipped ? `, skipped ${summary.skipped}` : '')
  )
  return summary
}

// ── Scoreboard ───────────────────────────────────────────────────────────────

export type ScoreboardBucket = {
  label: string
  total: number
  closed: number
  wins: number
  hit_rate: number | null
  avg_return: number | null
  avg_alpha: number | null
}

export type Scoreboard = {
  generated_at: string
  overall: ScoreboardBucket
  open_count: number
  by_status: Partial<Record<RecStatus, number>>
  by_direction: ScoreboardBucket[]
  by_conviction: ScoreboardBucket[]
  recent: Recommendation[]
}

function bucket(label: string, recs: Recommendation[]): ScoreboardBucket {
  const closed = recs.filter((r) => r.status !== 'OPEN' && r.current_return_pct !== null)
  const wins = closed.filter((r) => (r.current_return_pct ?? 0) > 0)

  const mean = (values: number[]): number | null =>
    values.length === 0 ? null : round(values.reduce((a, b) => a + b, 0) / values.length)

  const returns = closed.map((r) => r.current_return_pct!).filter(Number.isFinite)
  const alphas = closed
    .filter((r) => r.benchmark_return_pct !== null)
    .map((r) => r.current_return_pct! - r.benchmark_return_pct!)
    .filter(Number.isFinite)

  return {
    label,
    total: recs.length,
    closed: closed.length,
    wins: wins.length,
    hit_rate: closed.length > 0 ? round((wins.length / closed.length) * 100, 1) : null,
    avg_return: mean(returns),
    avg_alpha: mean(alphas),
  }
}

/**
 * `sinceDays = null` means all time. Alpha is the recommendation's return minus
 * SPY's return over the same holding period — the number that says whether any
 * of this beat just buying the index.
 */
export async function computeScoreboard(sinceDays: number | null = null): Promise<Scoreboard> {
  const all = await getRecommendationHistory(500)
  const cutoff =
    sinceDays === null ? null : new Date(Date.now() - sinceDays * 86_400_000).toISOString()
  const recs = cutoff ? all.filter((r) => r.created_at >= cutoff) : all

  const byStatus: Partial<Record<RecStatus, number>> = {}
  for (const r of recs) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1

  const convictionBuckets: ScoreboardBucket[] = []
  for (const level of [5, 4, 3, 2, 1]) {
    const subset = recs.filter((r) => r.conviction === level)
    if (subset.length > 0) convictionBuckets.push(bucket(`Conviction ${level}`, subset))
  }

  return {
    generated_at: new Date().toISOString(),
    overall: bucket('All', recs),
    open_count: recs.filter((r) => r.status === 'OPEN').length,
    by_status: byStatus,
    by_direction: [
      bucket('LONG', recs.filter((r) => r.direction === 'LONG')),
      bucket('SHORT', recs.filter((r) => r.direction === 'SHORT')),
    ].filter((b) => b.total > 0),
    by_conviction: convictionBuckets,
    recent: recs.slice(0, 100),
  }
}

/** Scoring only makes sense after a session that produced closes. */
export function shouldScoreToday(now = new Date()): boolean {
  const yesterday = new Date(now)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  return isTradingDay(yesterday) || isTradingDay(now)
}
