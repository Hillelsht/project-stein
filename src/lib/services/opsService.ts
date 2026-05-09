import { countAnalysesToday } from '@/lib/repositories/analysisRepo'
import { getLatestSignalCreatedAt } from '@/lib/repositories/signalRepo'
import { getLatestPolledAt } from '@/lib/repositories/sourceRepo'

// Soft thresholds — these drive both the /api/health JSON status and the OpsBanner.
// Tuned for a 5-user app on free infra; bump if false positives become annoying.
//
// We measure cron health via sources.last_polled_at (updated on every successful
// fetch, even if 0 new articles are saved), NOT articles.fetched_at — because the
// latter conflates cron health with news flow and false-alarms on quiet weekends.
//
// Cron schedule (cron.yml):
//   - Mon-Fri 14-21 UTC: every 10 min  → expected gap < 10 min
//   - Otherwise: top of every hour     → expected gap < 60 min
// 90 min covers worst case + cron slack + Vercel cold start.
const STALE_POLL_MINUTES   = 90
const QUIET_SIGNAL_HOURS   = 36       // weekends + slow news days can stretch this; 36h is the realistic alarm point
const LLM_DAILY_BUDGET     = 800      // mirrors llmService cap
const LLM_BUDGET_WARN_PCT  = 0.8

export type HealthStatus = 'ok' | 'degraded' | 'unknown'

export type PipelineHealth = {
  status: HealthStatus
  checked_at: string
  latest_source_polled_at: string | null
  minutes_since_last_poll: number | null
  latest_signal_created_at: string | null
  hours_since_last_signal: number | null
  analyses_today: number
  llm_budget_used_pct: number
  issues: string[]
}

function minutesSince(iso: string | null, now: number): number | null {
  if (!iso) return null
  return Math.floor((now - new Date(iso).getTime()) / 60_000)
}

export async function getPipelineHealth(): Promise<PipelineHealth> {
  const now = Date.now()
  const [latestPolled, latestSignal, analysesToday] = await Promise.all([
    getLatestPolledAt(),
    getLatestSignalCreatedAt(),
    countAnalysesToday(),
  ])

  const minsSincePoll = minutesSince(latestPolled, now)
  const minsSinceSignal = minutesSince(latestSignal, now)
  const hoursSinceSignal = minsSinceSignal === null ? null : Math.floor(minsSinceSignal / 60)
  const budgetUsedPct = analysesToday / LLM_DAILY_BUDGET

  const issues: string[] = []

  if (minsSincePoll === null) {
    issues.push('No source has ever been polled.')
  } else if (minsSincePoll > STALE_POLL_MINUTES) {
    issues.push(`Last RSS poll was ${minsSincePoll} minutes ago — cron may not be firing.`)
  }

  if (minsSinceSignal === null) {
    issues.push('No signals have ever been produced.')
  } else if (hoursSinceSignal !== null && hoursSinceSignal > QUIET_SIGNAL_HOURS) {
    issues.push(`No new signals in ${hoursSinceSignal} hours.`)
  }

  if (budgetUsedPct >= 1) {
    issues.push(`LLM daily budget hit (${analysesToday}/${LLM_DAILY_BUDGET}) — analyze pipeline is paused until UTC midnight.`)
  } else if (budgetUsedPct >= LLM_BUDGET_WARN_PCT) {
    issues.push(`LLM daily budget at ${Math.round(budgetUsedPct * 100)}% (${analysesToday}/${LLM_DAILY_BUDGET}).`)
  }

  const status: HealthStatus =
    issues.length === 0 ? 'ok' :
    minsSincePoll === null && minsSinceSignal === null ? 'unknown' :
    'degraded'

  return {
    status,
    checked_at: new Date(now).toISOString(),
    latest_source_polled_at: latestPolled,
    minutes_since_last_poll: minsSincePoll,
    latest_signal_created_at: latestSignal,
    hours_since_last_signal: hoursSinceSignal,
    analyses_today: analysesToday,
    llm_budget_used_pct: Math.round(budgetUsedPct * 100) / 100,
    issues,
  }
}
