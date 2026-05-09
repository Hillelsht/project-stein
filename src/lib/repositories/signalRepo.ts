import { createServiceClient } from '@/lib/supabase/server'

export type Sentiment = 'BULLISH' | 'BEARISH' | 'NEUTRAL'

export type MarketSignal = {
  id: string
  analysis_id: string
  ticker_symbol: string
  sentiment: Sentiment
  sentiment_score: number
  created_at: string
}

export type NewSignal = {
  analysis_id: string
  ticker_symbol: string
  sentiment: Sentiment
  sentiment_score: number
}

export type SignalFilters = {
  tickers?: string[]
  minScore?: number
  limit?: number
}

export async function saveSignal(signal: NewSignal): Promise<MarketSignal> {
  const db = createServiceClient()
  const { data, error } = await db
    .from('market_signals')
    .insert(signal)
    .select()
    .single()
  if (error) throw error
  return data as MarketSignal
}

export async function getRecentSignals(filters: SignalFilters = {}): Promise<MarketSignal[]> {
  const db = createServiceClient()
  let query = db
    .from('market_signals')
    .select('*')
    .order('sentiment_score', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(filters.limit ?? 100)

  if (filters.tickers && filters.tickers.length > 0) {
    query = query.in('ticker_symbol', filters.tickers)
  }
  if (filters.minScore !== undefined) {
    query = query.gte('sentiment_score', filters.minScore)
  }

  const { data, error } = await query
  if (error) throw error
  return data as MarketSignal[]
}

export type SignalWithContext = MarketSignal & {
  ai_analyses: {
    summary: string | null
    economic_impact: string | null
    articles: {
      title: string
      url: string
      published_at: string | null
      sources: { name: string } | null
    } | null
  } | null
}

export async function getRecentSignalsWithContext(
  filters: SignalFilters = {},
): Promise<SignalWithContext[]> {
  const db = createServiceClient()
  let query = db
    .from('market_signals')
    .select(
      '*, ai_analyses!inner(summary, economic_impact, articles!inner(title, url, published_at, sources(name)))',
    )
    .order('created_at', { ascending: false })
    .limit(filters.limit ?? 50)

  if (filters.tickers && filters.tickers.length > 0) {
    query = query.in('ticker_symbol', filters.tickers)
  }
  if (filters.minScore !== undefined) {
    query = query.gte('sentiment_score', filters.minScore)
  }

  const { data, error } = await query
  if (error) throw error
  return data as unknown as SignalWithContext[]
}

export async function getLatestSignalCreatedAt(): Promise<string | null> {
  const db = createServiceClient()
  const { data, error } = await db
    .from('market_signals')
    .select('created_at')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data?.created_at as string | undefined) ?? null
}

export async function getSignalsNeedingOutcomes(cutoffDays: number): Promise<MarketSignal[]> {
  const db = createServiceClient()
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - cutoffDays)

  // Signals in the past N days that don't yet have a signal_outcomes row
  const { data, error } = await db
    .from('market_signals')
    .select('*')
    .gte('created_at', cutoff.toISOString())
    .order('created_at', { ascending: true })
  if (error) throw error
  return data as MarketSignal[]
}
