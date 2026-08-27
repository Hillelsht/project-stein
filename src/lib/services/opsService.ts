import { getLatestPolledAt } from '@/lib/repositories/sourceRepo'
import { getBrief, getLatestGeneratedAt } from '@/lib/repositories/briefRepo'
import { getLatestSyncedAt } from '@/lib/repositories/positionRepo'
import { getStalestOpenPricedAt } from '@/lib/repositories/recommendationRepo'
import { isTradingDay, toDateKey } from '@/lib/marketCalendar'

/**
 * Health checks for the 2.0 pipeline.
 *
 * The guiding rule, learned from 1.0: measure whether the *machinery ran*, not
 * whether the world was interesting. 1.0 alarmed on `articles.fetched_at`,
 * which goes quiet on slow news days even when the cron is perfectly healthy.
 */

// Ingest runs every 30 min in market hours, hourly otherwise. 90 min covers the
// worst case plus cron slack and a cold start.
const STALE_POLL_MINUTES = 90

// Sync runs twice each weekday; >30h means at least one full day was missed.
const STALE_POSITIONS_HOURS = 30

// Scoring runs nightly Tue–Sat.
const STALE_PRICING_HOURS = 48

// Brief slots in UTC, with the grace period after which a missing brief is a
// problem rather than a race with the cron.
const PREMARKET_DUE_UTC_HOUR = 12 // job fires 11:00, retry 11:45
const EVENING_DUE_UTC_HOUR = 23 // job fires 21:30, retry 22:15

export type HealthStatus = 'ok' | 'degraded' | 'unknown'

export type PipelineHealth = {
  status: HealthStatus
  checked_at: string
  latest_source_polled_at: string | null
  minutes_since_last_poll: number | null
  latest_brief_generated_at: string | null
  hours_since_last_brief: number | null
  latest_positions_sync_at: string | null
  hours_since_positions_sync: number | null
  issues: string[]
}

function minutesSince(iso: string | null, now: number): number | null {
  if (!iso) return null
  return Math.floor((now - new Date(iso).getTime()) / 60_000)
}

function hoursSince(iso: string | null, now: number): number | null {
  const mins = minutesSince(iso, now)
  return mins === null ? null : Math.floor(mins / 60)
}

/** Which scheduled briefs should already exist today, given the current time. */
function expectedBriefsToday(now: Date): ('PREMARKET' | 'EVENING')[] {
  if (!isTradingDay(now)) return []
  const hour = now.getUTCHours()
  const expected: ('PREMARKET' | 'EVENING')[] = []
  if (hour >= PREMARKET_DUE_UTC_HOUR) expected.push('PREMARKET')
  if (hour >= EVENING_DUE_UTC_HOUR) expected.push('EVENING')
  return expected
}

export async function getPipelineHealth(): Promise<PipelineHealth> {
  const nowDate = new Date()
  const now = nowDate.getTime()
  const today = toDateKey(nowDate)

  const expected = expectedBriefsToday(nowDate)

  const [latestPolled, latestBrief, latestSync, stalestPriced, ...briefs] = await Promise.all([
    getLatestPolledAt(),
    getLatestGeneratedAt(),
    getLatestSyncedAt(),
    getStalestOpenPricedAt(),
    ...expected.map((type) => getBrief(today, type)),
  ])

  const minsSincePoll = minutesSince(latestPolled, now)
  const hoursSinceBrief = hoursSince(latestBrief, now)
  const hoursSinceSync = hoursSince(latestSync, now)

  const issues: string[] = []

  // ── Is the cron firing at all? ──
  if (minsSincePoll === null) {
    issues.push('No source has ever been polled — the cron may be disabled.')
  } else if (minsSincePoll > STALE_POLL_MINUTES) {
    issues.push(
      `Last news poll was ${minsSincePoll} minutes ago — the GitHub Actions cron may be disabled.`
    )
  }

  // ── Did today's briefs actually land? ──
  expected.forEach((type, i) => {
    const brief = briefs[i]
    const label = type === 'PREMARKET' ? 'Pre-market' : 'Evening'
    if (!brief) {
      issues.push(`${label} brief for ${today} was never generated.`)
    } else if (brief.status === 'FAILED') {
      issues.push(`${label} brief failed: ${brief.error ?? 'unknown error'}`)
    } else if (brief.status === 'PENDING') {
      issues.push(`${label} brief is still pending — the Actions worker may not have reported back.`)
    } else if (!brief.emailed_at) {
      issues.push(`${label} brief generated but was not emailed.`)
    }
  })

  // ── Is the portfolio the briefs reason over still current? ──
  if (latestSync === null) {
    issues.push('IBKR positions have never synced.')
  } else if (hoursSinceSync !== null && hoursSinceSync > STALE_POSITIONS_HOURS) {
    issues.push(`Positions last synced ${hoursSinceSync}h ago — the brief may be using stale holdings.`)
  }

  // ── Is the ledger still being priced? ──
  if (stalestPriced === null) {
    // Either there are no open recommendations (fine) or one has never been
    // priced. Only the latter is worth flagging, and it self-resolves on the
    // next nightly run, so this is deliberately not an issue.
  } else {
    const hoursSincePricing = hoursSince(stalestPriced, now)
    if (hoursSincePricing !== null && hoursSincePricing > STALE_PRICING_HOURS) {
      issues.push(`Open recommendations unpriced for ${hoursSincePricing}h — scoring may not be running.`)
    }
  }

  const status: HealthStatus =
    issues.length === 0 ? 'ok' : minsSincePoll === null && latestBrief === null ? 'unknown' : 'degraded'

  return {
    status,
    checked_at: nowDate.toISOString(),
    latest_source_polled_at: latestPolled,
    minutes_since_last_poll: minsSincePoll,
    latest_brief_generated_at: latestBrief,
    hours_since_last_brief: hoursSinceBrief,
    latest_positions_sync_at: latestSync,
    hours_since_positions_sync: hoursSinceSync,
    issues,
  }
}
