import { createServiceClient } from '@/lib/supabase/server'

export type WatchlistEntry = {
  id: string
  user_id: string
  ticker_symbol: string
  created_at: string
}

export async function getWatchlist(userId: string): Promise<WatchlistEntry[]> {
  const db = createServiceClient()
  const { data, error } = await db
    .from('watchlist')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data as WatchlistEntry[]
}

export async function addTicker(userId: string, tickerSymbol: string): Promise<WatchlistEntry> {
  const db = createServiceClient()
  const { data, error } = await db
    .from('watchlist')
    .insert({ user_id: userId, ticker_symbol: tickerSymbol.toUpperCase() })
    .select()
    .single()
  if (error) throw error
  return data as WatchlistEntry
}

export async function removeTicker(userId: string, tickerSymbol: string): Promise<void> {
  const db = createServiceClient()
  const { error } = await db
    .from('watchlist')
    .delete()
    .eq('user_id', userId)
    .eq('ticker_symbol', tickerSymbol.toUpperCase())
  if (error) throw error
}

// Returns every ticker symbol watched by any user — used by filterService to
// prioritize articles before the LLM budget check.
export async function getAllWatchlistTickers(): Promise<string[]> {
  const db = createServiceClient()
  const { data, error } = await db
    .from('watchlist')
    .select('ticker_symbol')
  if (error) throw error
  return [...new Set((data as { ticker_symbol: string }[]).map((r) => r.ticker_symbol))]
}
