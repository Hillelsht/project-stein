import { createServiceClient } from '@/lib/supabase/server'

export type SignalOutcome = {
  id: string
  signal_id: string
  ticker_symbol: string
  price_at_signal: number | null
  price_1h: number | null
  price_1d: number | null
  price_3d: number | null
  price_7d: number | null
  return_1h: number | null
  return_1d: number | null
  return_3d: number | null
  return_7d: number | null
  last_updated_at: string | null
  created_at: string
}

export type HorizonData = {
  ticker_symbol: string
  price_at_signal?: number | null
  price_1h?: number | null
  price_1d?: number | null
  price_3d?: number | null
  price_7d?: number | null
  return_1h?: number | null
  return_1d?: number | null
  return_3d?: number | null
  return_7d?: number | null
}

export type StatsBucket = {
  sentiment: string
  score_bucket: '0-4' | '5-7' | '8-10'
  count: number
  mean_return_1d: number | null
  mean_return_3d: number | null
  hit_rate_1d: number | null
}

export async function upsertOutcome(signalId: string, data: HorizonData): Promise<void> {
  const db = createServiceClient()
  const { error } = await db
    .from('signal_outcomes')
    .upsert(
      { signal_id: signalId, ...data, last_updated_at: new Date().toISOString() },
      { onConflict: 'signal_id' }
    )
  if (error) throw error
}

export async function getOutcomeBySignalId(signalId: string): Promise<SignalOutcome | null> {
  const db = createServiceClient()
  const { data, error } = await db
    .from('signal_outcomes')
    .select('*')
    .eq('signal_id', signalId)
    .maybeSingle()
  if (error) throw error
  return data as SignalOutcome | null
}

export async function getStats(days: number): Promise<SignalOutcome[]> {
  const db = createServiceClient()
  const since = new Date()
  since.setDate(since.getDate() - days)
  const { data, error } = await db
    .from('signal_outcomes')
    .select('*')
    .gte('created_at', since.toISOString())
  if (error) throw error
  return data as SignalOutcome[]
}

export type OutcomeWithSignal = SignalOutcome & {
  market_signals: { sentiment: string; sentiment_score: number } | null
}

export async function getStatsWithSignals(days: number): Promise<OutcomeWithSignal[]> {
  const db = createServiceClient()
  const since = new Date()
  since.setDate(since.getDate() - days)
  const { data, error } = await db
    .from('signal_outcomes')
    .select('*, market_signals(sentiment, sentiment_score)')
    .gte('created_at', since.toISOString())
  if (error) throw error
  return data as OutcomeWithSignal[]
}
