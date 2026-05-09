import { getLatestFetchedAt } from '@/lib/repositories/articleRepo'
import { countAnalysesToday } from '@/lib/repositories/analysisRepo'
import { getLatestSignalCreatedAt } from '@/lib/repositories/signalRepo'

// Soft thresholds — these drive both the /api/health JSON status and the OpsBanner.
// Tuned for a 5-user app on free infra; bump if false positives become annoying.
const STALE_INGEST_MINUTES = 90       // ingest cron fires every 10 min during market hours; 90 min covers off-hours pacing too
const QUIET_SIGNAL_HOURS   = 36       // weekend gaps + naturally quiet news days can stretch this; 36h is the realistic alarm point
const LLM_DAILY_BUDGET     = 800      // mirrors llmService cap
const LLM_BUDGET_WARN_PCT  = 0.8

export type HealthStatus = 'ok' | 'degraded' | 'unknown'

export type PipelineHealth = {
  status: HealthStatus
  checked_at: string
  latest_article_fetched_at: string | null
  minutes_since_last_article: number | null
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
  const [latestFetched, latestSignal, analysesToday] = await Promise.all([
    getLatestFetchedAt(),
    getLatestSignalCreatedAt(),
    countAnalysesToday(),
  ])

  const minsSinceArticle = minutesSince(latestFetched, now)
  const minsSinceSignal = minutesSince(latestSignal, now)
  const hoursSinceSignal = minsSinceSignal === null ? null : Math.floor(minsSinceSignal / 60)
  const budgetUsedPct = analysesToday / LLM_DAILY_BUDGET

  const issues: string[] = []

  if (minsSinceArticle === null) {
    issues.push('No articles have ever been ingested.')
  } else if (minsSinceArticle > STALE_INGEST_MINUTES) {
    issues.push(`Last article was fetched ${minsSinceArticle} minutes ago.`)
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
    minsSinceArticle === null && minsSinceSignal === null ? 'unknown' :
    'degraded'

  return {
    status,
    checked_at: new Date(now).toISOString(),
    latest_article_fetched_at: latestFetched,
    minutes_since_last_article: minsSinceArticle,
    latest_signal_created_at: latestSignal,
    hours_since_last_signal: hoursSinceSignal,
    analyses_today: analysesToday,
    llm_budget_used_pct: Math.round(budgetUsedPct * 100) / 100,
    issues,
  }
}
