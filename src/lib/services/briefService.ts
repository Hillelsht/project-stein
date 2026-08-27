import { addTradingDays, toDateKey } from '@/lib/marketCalendar'
import { buildBriefPrompt } from '@/lib/prompts/briefPrompt'
import {
  createBrief,
  getBrief,
  getBriefById,
  getStalePendingBriefs,
  updateBrief,
  type Brief,
  type BriefContent,
  type BriefType,
} from '@/lib/repositories/briefRepo'
import {
  closeRecommendation,
  createRecommendations,
  getOpenRecommendations,
  updateInvalidation,
  type NewRecommendation,
} from '@/lib/repositories/recommendationRepo'
import { getPositionTickers } from '@/lib/repositories/positionRepo'
import { validateTickerBatch } from '@/lib/repositories/tickerMasterRepo'
import { getSetting } from '@/lib/repositories/settingsRepo'
import { getRecommendationsForBrief } from '@/lib/repositories/recommendationRepo'
import { briefSubject, renderBriefHtml } from '@/lib/briefHtml'
import { buildContextPack, toCompactPack, type ContextPack } from '@/lib/services/contextPackService'
import { dispatchBriefWorker } from '@/lib/services/dispatchService'
import { EmailNotConfiguredError, getRecipient, sendEmail } from '@/lib/services/emailService'
import { callModelForJson } from '@/lib/services/llmClient'
import { sendPushToAllSubscriptions } from '@/lib/services/pushService'
import {
  DEFAULT_MODEL_ID,
  getModelOrDefault,
  VERCEL_FALLBACK_CHAIN,
  type ModelEntry,
} from '@/lib/services/modelRegistry'

/**
 * Brief generation: build the pack, ask a model, validate hard, persist.
 *
 * The validation stage is deliberately unforgiving. A brief is only worth
 * something if its recommendations can be scored later, so anything that
 * cannot be scored — a hallucinated ticker, an invalidation on the wrong side
 * of the entry — is dropped rather than stored.
 */

const MAX_MACRO_BULLETS = 8
const MAX_NEW_IDEAS = 3

export type RawBrief = {
  macro_bullets?: unknown
  holdings_reviews?: unknown
  rec_updates?: unknown
  new_ideas?: unknown
  calendar?: unknown
}

// ── Validation helpers ───────────────────────────────────────────────────────

function clampInt(value: unknown, min: number, max: number): number | null {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return null
  return Math.min(max, Math.max(min, n))
}

function finiteNumber(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function cleanString(value: unknown, maxLen = 2000): string | null {
  if (typeof value !== 'string') return null
  const s = value.trim()
  return s.length > 0 ? s.slice(0, maxLen) : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/**
 * Array entries that are not objects. Models occasionally emit `[null]` or a
 * bare string inside a structured array; without this guard the whole brief
 * throws on `item.ticker` and one malformed entry costs the owner the run.
 */
function asRecord(item: unknown): Record<string, unknown> | null {
  return typeof item === 'object' && item !== null && !Array.isArray(item)
    ? (item as Record<string, unknown>)
    : null
}

const HOLDING_ACTIONS = new Set(['HOLD', 'TRIM', 'ADD', 'CLOSE', 'WATCH'])
const REC_DECISIONS = new Set(['MAINTAIN', 'CLOSE', 'TIGHTEN_INVALIDATION'])

// ── Core validation ──────────────────────────────────────────────────────────

export type ValidationContext = {
  pack: ContextPack
  positionTickers: Set<string>
  openRecIds: Map<string, { ticker: string; direction: 'LONG' | 'SHORT' }>
  validTickers: (t: string) => boolean
}

export async function buildValidationContext(pack: ContextPack): Promise<ValidationContext> {
  const [positionTickers, openRecs] = await Promise.all([
    getPositionTickers(),
    getOpenRecommendations(),
  ])

  // Candidate tickers the model might name: anything in the pack plus held names.
  const candidates = new Set<string>([
    ...positionTickers,
    ...pack.watchlist.map((w) => w.ticker),
    ...pack.open_recommendations.map((r) => r.ticker),
    ...pack.news.flatMap((n) => n.tickers),
  ])

  return {
    pack,
    positionTickers: new Set(positionTickers),
    openRecIds: new Map(
      openRecs.map((r) => [r.id, { ticker: r.ticker_symbol, direction: r.direction }])
    ),
    // Resolved lazily per idea below; seeded here to avoid a round trip per ticker.
    validTickers: (t: string) => candidates.has(t),
  }
}

export type ValidatedBrief = {
  content: BriefContent
  dropped: string[]
}

export async function validateBrief(
  raw: RawBrief,
  ctx: ValidationContext
): Promise<ValidatedBrief> {
  const dropped: string[] = []

  // ── macro bullets ──
  const macro_bullets = asArray(raw.macro_bullets)
    .map((b) => cleanString(b, 400))
    .filter((b): b is string => b !== null)
    .slice(0, MAX_MACRO_BULLETS)

  // ── holdings reviews: must be about a ticker actually held ──
  const holdings_reviews: BriefContent['holdings_reviews'] = []
  for (const item of asArray(raw.holdings_reviews)) {
    const r = asRecord(item)
    if (!r) continue
    const ticker = cleanString(r.ticker, 10)?.toUpperCase()
    const action = cleanString(r.action, 10)?.toUpperCase()
    const rationale = cleanString(r.rationale)
    if (!ticker || !action || !rationale) continue
    if (!HOLDING_ACTIONS.has(action)) {
      dropped.push(`holding review ${ticker}: unknown action ${action}`)
      continue
    }
    if (!ctx.positionTickers.has(ticker)) {
      dropped.push(`holding review ${ticker}: not a current position`)
      continue
    }
    holdings_reviews.push({
      ticker,
      action: action as BriefContent['holdings_reviews'][number]['action'],
      rationale,
    })
  }

  // ── rec updates: must reference an actually-open recommendation ──
  const rec_updates: BriefContent['rec_updates'] = []
  for (const item of asArray(raw.rec_updates)) {
    const r = asRecord(item)
    if (!r) continue
    const id = cleanString(r.recommendation_id, 64)
    const decision = cleanString(r.decision, 32)?.toUpperCase()
    const note = cleanString(r.note) ?? ''
    if (!id || !decision) continue
    if (!REC_DECISIONS.has(decision)) {
      dropped.push(`rec update ${id}: unknown decision ${decision}`)
      continue
    }
    const open = ctx.openRecIds.get(id)
    if (!open) {
      dropped.push(`rec update ${id}: not an open recommendation`)
      continue
    }
    const newInvalidation = finiteNumber(r.new_invalidation)
    rec_updates.push({
      recommendation_id: id,
      ticker: open.ticker,
      decision: decision as BriefContent['rec_updates'][number]['decision'],
      note,
      new_invalidation: decision === 'TIGHTEN_INVALIDATION' ? newInvalidation : null,
    })
  }

  // ── new ideas: the strictest gate, since these become tracked bets ──
  const ideaCandidates: BriefContent['new_ideas'] = []
  const tickerLookup: string[] = []

  for (const item of asArray(raw.new_ideas)) {
    const r = asRecord(item)
    if (!r) continue
    const ticker = cleanString(r.ticker, 10)?.toUpperCase()
    const direction = cleanString(r.direction, 8)?.toUpperCase()
    const thesis = cleanString(r.thesis)
    const low = finiteNumber(r.entry_zone_low)
    const high = finiteNumber(r.entry_zone_high)
    const invalidation = finiteNumber(r.invalidation_price)
    const horizon = clampInt(r.horizon_trading_days, 1, 20)
    const conviction = clampInt(r.conviction, 1, 5)

    if (!ticker || !thesis || invalidation === null || horizon === null || conviction === null) {
      dropped.push(`idea ${ticker ?? '?'}: missing required fields`)
      continue
    }
    if (direction !== 'LONG' && direction !== 'SHORT') {
      dropped.push(`idea ${ticker}: invalid direction ${direction}`)
      continue
    }
    if (invalidation <= 0) {
      dropped.push(`idea ${ticker}: invalidation must be positive`)
      continue
    }

    // Normalise the entry zone; fall back to the pack's last close if absent.
    const packClose =
      ctx.pack.positions.find((p) => p.ticker === ticker)?.technicals?.last_close ??
      ctx.pack.watchlist.find((w) => w.ticker === ticker)?.technicals?.last_close ??
      null
    const zoneLow = low !== null && high !== null ? Math.min(low, high) : (low ?? high ?? packClose)
    const zoneHigh = low !== null && high !== null ? Math.max(low, high) : (high ?? low ?? packClose)

    if (zoneLow === null || zoneHigh === null) {
      dropped.push(`idea ${ticker}: no entry zone and no reference price`)
      continue
    }

    // An invalidation on the wrong side of the entry can never trigger, which
    // would leave a bet that quietly runs to its horizon no matter what.
    if (direction === 'LONG' && invalidation >= zoneLow) {
      dropped.push(`idea ${ticker}: LONG invalidation ${invalidation} not below entry ${zoneLow}`)
      continue
    }
    if (direction === 'SHORT' && invalidation <= zoneHigh) {
      dropped.push(`idea ${ticker}: SHORT invalidation ${invalidation} not above entry ${zoneHigh}`)
      continue
    }

    ideaCandidates.push({
      ticker,
      direction,
      thesis,
      entry_zone_low: zoneLow,
      entry_zone_high: zoneHigh,
      invalidation_price: invalidation,
      horizon_trading_days: horizon,
      conviction,
    })
    tickerLookup.push(ticker)
  }

  // One batched DB check for tickers not already known from positions/pack.
  const unknown = [...new Set(tickerLookup)].filter(
    (t) => !ctx.positionTickers.has(t) && !ctx.validTickers(t)
  )
  // If the ticker lookup fails, treat every unknown symbol as unverified rather
  // than throwing: an idea we cannot confirm is an idea we must not persist.
  let verified = new Set<string>()
  if (unknown.length > 0) {
    try {
      verified = new Set(await validateTickerBatch(unknown))
    } catch (err) {
      console.warn('[brief] ticker validation unavailable:', (err as Error).message)
    }
  }

  const new_ideas = ideaCandidates
    .filter((idea) => {
      const known =
        ctx.positionTickers.has(idea.ticker) ||
        ctx.validTickers(idea.ticker) ||
        verified.has(idea.ticker)
      if (!known) dropped.push(`idea ${idea.ticker}: unknown ticker`)
      return known
    })
    .slice(0, MAX_NEW_IDEAS)

  // ── calendar ──
  const calendar: BriefContent['calendar'] = []
  for (const item of asArray(raw.calendar)) {
    const r = asRecord(item)
    if (!r) continue
    const date = cleanString(r.date, 20)
    const label = cleanString(r.label, 200)
    if (!date || !label) continue
    calendar.push({ date, label, ticker: cleanString(r.ticker, 10)?.toUpperCase() ?? null })
  }

  if (dropped.length > 0) {
    console.warn(`[brief] dropped ${dropped.length} item(s):`, dropped.join('; '))
  }

  return {
    content: { macro_bullets, holdings_reviews, rec_updates, new_ideas, calendar },
    dropped,
  }
}

// ── Ledger writes ────────────────────────────────────────────────────────────

export async function applyBriefToLedger(
  brief: Brief,
  content: BriefContent,
  pack: ContextPack
): Promise<{ opened: number; closed: number; tightened: number }> {
  const spy = pack.macro.find((m) => m.ticker === 'SPY')?.last ?? null
  const today = new Date()

  // Model-directed updates to existing calls.
  let closed = 0
  let tightened = 0
  for (const update of content.rec_updates) {
    if (update.decision === 'CLOSE') {
      const current =
        pack.open_recommendations.find((r) => r.id === update.recommendation_id)?.current_price ??
        null
      await closeRecommendation(update.recommendation_id, {
        status: 'CLOSED_BY_MODEL',
        close_price: current,
        closed_by_brief_id: brief.id,
        close_note: update.note,
      })
      closed++
    } else if (update.decision === 'TIGHTEN_INVALIDATION' && update.new_invalidation != null) {
      await updateInvalidation(update.recommendation_id, update.new_invalidation)
      tightened++
    }
  }

  // New ideas enter the ledger with their basis snapshotted, so returns are
  // always measured from a fixed point even if prices move before the read.
  const rows: NewRecommendation[] = content.new_ideas.map((idea) => {
    // Validation guarantees both zone bounds are present; the midpoint is only
    // a fallback for a ticker with no technicals in the pack.
    const zoneMid =
      idea.entry_zone_low !== null && idea.entry_zone_high !== null
        ? (idea.entry_zone_low + idea.entry_zone_high) / 2
        : null

    const entryPrice =
      pack.positions.find((p) => p.ticker === idea.ticker)?.technicals?.last_close ??
      pack.watchlist.find((w) => w.ticker === idea.ticker)?.technicals?.last_close ??
      zoneMid

    return {
      brief_id: brief.id,
      ticker_symbol: idea.ticker,
      direction: idea.direction,
      thesis: idea.thesis,
      entry_zone_low: idea.entry_zone_low,
      entry_zone_high: idea.entry_zone_high,
      invalidation_price: idea.invalidation_price,
      horizon_trading_days: idea.horizon_trading_days,
      horizon_date: toDateKey(addTradingDays(today, idea.horizon_trading_days)),
      conviction: idea.conviction,
      entry_price: entryPrice,
      benchmark_entry_price: spy,
    }
  })

  const created = await createRecommendations(rows)
  return { opened: created.length, closed, tightened }
}

// ── Delivery ─────────────────────────────────────────────────────────────────

/**
 * Emails the brief and fires a push. Delivery failures are logged and swallowed:
 * a brief that generated correctly but couldn't be emailed is still a good
 * brief, and the retry cron re-attempts the email on its next pass.
 */
export async function deliverBrief(briefId: string): Promise<{ emailed: boolean; pushed: boolean }> {
  const brief = await getBriefById(briefId)
  if (!brief || brief.status !== 'GENERATED' || !brief.content) {
    return { emailed: false, pushed: false }
  }

  const content = brief.content
  const pack = (brief.context_pack as unknown as ContextPack | null) ?? null
  let emailed = Boolean(brief.emailed_at)
  let pushed = Boolean(brief.pushed_at)

  if (!emailed) {
    try {
      const to = getRecipient()
      if (!to) throw new EmailNotConfiguredError('BRIEF_RECIPIENT_EMAIL')
      const recommendations = await getRecommendationsForBrief(brief.id)
      const html = renderBriefHtml({
        brief,
        content,
        recommendations,
        pack,
        appUrl: process.env.NEXT_PUBLIC_APP_URL ?? null,
      })
      await sendEmail({ to, subject: briefSubject(brief, content), html })
      await updateBrief(brief.id, { emailed_at: new Date().toISOString() })
      emailed = true
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn('[brief] email delivery failed:', message)
    }
  }

  if (!pushed) {
    try {
      const label =
        brief.brief_type === 'EVENING'
          ? 'Evening wrap ready'
          : brief.brief_type === 'ON_DEMAND'
            ? 'Brief ready'
            : 'Pre-market brief ready'
      const sent = await sendPushToAllSubscriptions({
        title: `Stein — ${label}`,
        body: content.macro_bullets[0]?.slice(0, 160) ?? 'Open Stein for today’s brief.',
        // 1.0 pushed '/?highlight=<id>', which no page ever handled.
        url: '/',
        tag: 'stein-brief',
      })
      if (sent > 0) {
        await updateBrief(brief.id, { pushed_at: new Date().toISOString() })
        pushed = true
      }
    } catch (err) {
      console.warn('[brief] push delivery failed:', (err as Error).message)
    }
  }

  return { emailed, pushed }
}

// ── Orchestration ────────────────────────────────────────────────────────────

async function resolveDefaultModelId(): Promise<string> {
  const setting = await getSetting<string>('default_brief_model')
  return setting ?? DEFAULT_MODEL_ID
}

/** Models to try, in order, for a `vercel`-runner generation. */
function vercelChainFrom(requested: ModelEntry): ModelEntry[] {
  const chain: ModelEntry[] = []
  const seen = new Set<string>()
  const push = (id: string) => {
    if (seen.has(id)) return
    const m = getModelOrDefault(id)
    if (m.runner === 'vercel') {
      chain.push(m)
      seen.add(m.id)
    }
  }
  if (requested.runner === 'vercel') push(requested.id)
  for (const id of VERCEL_FALLBACK_CHAIN) push(id)
  return chain
}

export type GenerateResult = {
  ok: boolean
  brief_id: string
  status: Brief['status']
  already?: boolean
  model?: string
  opened?: number
  closed?: number
  dropped?: number
  error?: string
}

/**
 * Generates (or regenerates) a brief for a slot.
 *
 * Idempotent: an existing GENERATED brief is left alone, so the cron can fire
 * twice per slot — once on time, once as a retry — and a transient provider
 * failure heals itself without any extra machinery.
 */
export async function generateBrief(args: {
  briefType: BriefType
  modelId?: string | null
  force?: boolean
}): Promise<GenerateResult> {
  const { briefType, force = false } = args
  const briefDate = toDateKey(new Date())
  const scheduled = briefType !== 'ON_DEMAND'

  const existing = scheduled ? await getBrief(briefDate, briefType) : null
  if (existing && existing.status === 'GENERATED' && !force) {
    // Already generated — but the retry firing is also where an email that
    // failed the first time gets another chance.
    await deliverBrief(existing.id)
    return { ok: true, brief_id: existing.id, status: 'GENERATED', already: true }
  }

  const modelId = args.modelId ?? (await resolveDefaultModelId())
  const requested = getModelOrDefault(modelId)

  // A subscription-backed model can't run inside this request. Hand it to the
  // GitHub Actions worker; the stale-pending sweep below is the safety net if
  // the worker never reports back.
  if (requested.runner === 'actions') {
    try {
      const { briefId } = await dispatchBriefWorker(requested, briefType)
      return { ok: true, brief_id: briefId, status: 'PENDING', model: requested.id }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`[brief] dispatch failed (${message}) — falling back to inline models`)
      // Fall through and generate with the vercel chain rather than
      // leaving the owner with no brief at all.
    }
  }

  const brief =
    existing ??
    (await createBrief({
      brief_date: briefDate,
      brief_type: briefType,
      status: 'PENDING',
      requested_model: requested.id,
    }))

  if (existing) {
    await updateBrief(brief.id, {
      status: 'PENDING',
      requested_model: requested.id,
      attempt_count: (existing.attempt_count ?? 0) + 1,
      error: null,
    })
  }

  try {
    const pack = await buildContextPack(briefType)
    const chain = vercelChainFrom(requested)

    for (const model of chain) {
      const prompt = buildBriefPrompt(model.requiresCompactPack ? toCompactPack(pack) : pack)
      const result = await callModelForJson<RawBrief>(model, prompt)
      if (!result) continue

      const ctx = await buildValidationContext(pack)
      const { content, dropped } = await validateBrief(result.parsed, ctx)

      const saved = await updateBrief(brief.id, {
        status: 'GENERATED',
        content,
        context_pack: pack as unknown as Record<string, unknown>,
        model: model.id,
        tokens_in: result.raw.tokensIn,
        tokens_out: result.raw.tokensOut,
        generated_at: new Date().toISOString(),
        error: null,
      })

      const ledger = await applyBriefToLedger(saved, content, pack)
      await deliverBrief(saved.id)

      console.log(
        `[brief] ${briefType} ${briefDate} via ${model.id}: ` +
          `${ledger.opened} opened, ${ledger.closed} closed, ${dropped.length} dropped`
      )

      return {
        ok: true,
        brief_id: brief.id,
        status: 'GENERATED',
        model: model.id,
        opened: ledger.opened,
        closed: ledger.closed,
        dropped: dropped.length,
      }
    }

    const message = `all models failed (${chain.map((m) => m.id).join(', ')})`
    await updateBrief(brief.id, { status: 'FAILED', error: message })
    return { ok: false, brief_id: brief.id, status: 'FAILED', error: message }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await updateBrief(brief.id, { status: 'FAILED', error: message.slice(0, 500) })
    console.error('[brief] generation failed:', message)
    return { ok: false, brief_id: brief.id, status: 'FAILED', error: message }
  }
}

const STALE_PENDING_MINUTES = 30

/**
 * Rescues briefs stuck in PENDING — the Actions worker died, the runner queue
 * stalled, or the dispatch never landed. Regenerates them with the inline model
 * chain so a scheduled slot always ends with a brief the owner can read.
 *
 * Called from the retry cron firing, which is why the schedule fires twice.
 */
export async function healStalePendingBriefs(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_PENDING_MINUTES * 60_000).toISOString()
  const stale = await getStalePendingBriefs(cutoff)
  if (stale.length === 0) return 0

  let healed = 0
  for (const brief of stale) {
    console.warn(
      `[brief] ${brief.id.slice(0, 8)} stuck PENDING since ${brief.created_at} — regenerating inline`
    )
    // force: the row exists and is PENDING, so the idempotency check must not
    // short-circuit it.
    const result = await generateBrief({
      briefType: brief.brief_type,
      modelId: DEFAULT_MODEL_ID,
      force: true,
    })
    if (result.ok) healed++
  }
  return healed
}

/** Re-runs validation + persistence for output produced elsewhere (the Claude worker). */
export async function completeBriefFromRawOutput(
  briefId: string,
  raw: RawBrief,
  meta: { model: string; tokensIn?: number; tokensOut?: number }
): Promise<GenerateResult> {
  const brief = await getBriefById(briefId)
  if (!brief) throw new Error(`brief ${briefId} not found`)
  if (!brief.context_pack) throw new Error(`brief ${briefId} has no stored context pack`)

  const pack = brief.context_pack as unknown as ContextPack
  const ctx = await buildValidationContext(pack)
  const { content, dropped } = await validateBrief(raw, ctx)

  const saved = await updateBrief(brief.id, {
    status: 'GENERATED',
    content,
    model: meta.model,
    tokens_in: meta.tokensIn ?? null,
    tokens_out: meta.tokensOut ?? null,
    generated_at: new Date().toISOString(),
    error: null,
  })

  const ledger = await applyBriefToLedger(saved, content, pack)
  await deliverBrief(saved.id)

  return {
    ok: true,
    brief_id: brief.id,
    status: 'GENERATED',
    model: meta.model,
    opened: ledger.opened,
    closed: ledger.closed,
    dropped: dropped.length,
  }
}
