import { getSignalsNeedingOutcomes } from '@/lib/repositories/signalRepo'
import { getOutcomeBySignalId, upsertOutcome, getStatsWithSignals } from '@/lib/repositories/outcomeRepo'
import { getClosingPriceAt, getPriceAtHorizon } from './priceService'
import type { HorizonData, StatsBucket } from '@/lib/repositories/outcomeRepo'

function scoreBucket(score: number): StatsBucket['score_bucket'] {
  if (score <= 4) return '0-4'
  if (score <= 7) return '5-7'
  return '8-10'
}

function pct(horizonPrice: number, base: number): number {
  return ((horizonPrice - base) / base) * 100
}

// 30-day window: long enough for the longest horizon (7d) to ripen with margin,
// and forgiving if the analyze pipeline pauses for a week or two.
export async function fillOutcomesForRecentSignals(): Promise<{ processed: number; updated: number }> {
  const signals = await getSignalsNeedingOutcomes(30)
  let processed = 0
  let updated = 0

  for (const signal of signals) {
    processed++
    const existing = await getOutcomeBySignalId(signal.id)
    const signalTime = new Date(signal.created_at)
    const patch: HorizonData = { ticker_symbol: signal.ticker_symbol }
    let dirty = false

    // Baseline price — closing price on or after signal date
    let base = existing?.price_at_signal ?? null
    if (base === null) {
      base = await getClosingPriceAt(signal.ticker_symbol, signalTime)
      if (base !== null) {
        patch.price_at_signal = base
        dirty = true
      }
    }

    // Horizon prices — fetch only those that are null and have ripened
    for (const h of ['1h', '1d', '3d', '7d'] as const) {
      const priceField = `price_${h}` as 'price_1h' | 'price_1d' | 'price_3d' | 'price_7d'
      const returnField = `return_${h}` as 'return_1h' | 'return_1d' | 'return_3d' | 'return_7d'

      if ((existing?.[priceField] ?? null) !== null) continue

      const p = await getPriceAtHorizon(signal, h)
      if (p !== null) {
        patch[priceField] = p
        if (base !== null) patch[returnField] = pct(p, base)
        dirty = true
      }
    }

    if (dirty) {
      await upsertOutcome(signal.id, patch)
      updated++
      console.log(
        `[validate] signal=${signal.id.slice(0, 8)} ticker=${signal.ticker_symbol} patched`,
      )
    }
  }

  console.log(`[validate] processed=${processed} updated=${updated}`)
  return { processed, updated }
}

export async function computeStats(days = 30): Promise<StatsBucket[]> {
  const rows = await getStatsWithSignals(days)

  type Acc = { count: number; returns1d: number[]; returns3d: number[] }
  const buckets = new Map<string, Acc>()

  for (const row of rows) {
    const sig = row.market_signals
    if (!sig) continue

    const key = `${sig.sentiment}|${scoreBucket(sig.sentiment_score)}`
    if (!buckets.has(key)) buckets.set(key, { count: 0, returns1d: [], returns3d: [] })
    const acc = buckets.get(key)!
    acc.count++
    if (row.return_1d !== null) acc.returns1d.push(row.return_1d)
    if (row.return_3d !== null) acc.returns3d.push(row.return_3d)
  }

  const avg = (arr: number[]): number | null =>
    arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null

  const hitRate = (arr: number[]): number | null =>
    arr.length ? arr.filter((r) => r > 0).length / arr.length : null

  const result: StatsBucket[] = []
  for (const [key, acc] of buckets) {
    const [sentiment, score_bucket] = key.split('|')
    result.push({
      sentiment,
      score_bucket: score_bucket as StatsBucket['score_bucket'],
      count: acc.count,
      mean_return_1d: avg(acc.returns1d),
      mean_return_3d: avg(acc.returns3d),
      hit_rate_1d: hitRate(acc.returns1d),
    })
  }

  return result.sort(
    (a, b) =>
      a.sentiment.localeCompare(b.sentiment) || a.score_bucket.localeCompare(b.score_bucket),
  )
}
