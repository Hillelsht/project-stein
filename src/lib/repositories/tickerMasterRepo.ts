import { createServiceClient } from '@/lib/supabase/server'

export type TickerRow = {
  ticker_symbol: string
  company_name: string | null
  exchange: string | null
  active: boolean
  last_refreshed_at: string | null
  created_at: string
}

// These symbols match the ticker regex but are never real tickers.
export const BLOCKLIST = new Set([
  'CEO', 'CFO', 'COO', 'CTO', 'SEC', 'FDA', 'USA', 'GDP', 'IRS',
  'ETF', 'IPO', 'LLC', 'INC', 'NYSE', 'NASD', 'SPAC', 'ESG',
])

export async function isValidTicker(symbol: string): Promise<boolean> {
  if (BLOCKLIST.has(symbol)) return false
  const db = createServiceClient()
  const { data, error } = await db
    .from('tickers_master')
    .select('ticker_symbol')
    .eq('ticker_symbol', symbol)
    .eq('active', true)
    .maybeSingle()
  if (error) throw error
  return data !== null
}

// Single DB call to validate a batch of candidate symbols.
// Returns only the symbols that exist in tickers_master as active.
export async function validateTickerBatch(symbols: string[]): Promise<string[]> {
  if (symbols.length === 0) return []
  const db = createServiceClient()
  const { data, error } = await db
    .from('tickers_master')
    .select('ticker_symbol')
    .in('ticker_symbol', symbols)
    .eq('active', true)
  if (error) throw error
  return (data as { ticker_symbol: string }[]).map((r) => r.ticker_symbol)
}

export async function searchTickers(
  prefix: string,
  limit = 10,
): Promise<Pick<TickerRow, 'ticker_symbol' | 'company_name'>[]> {
  if (!prefix.trim()) return []
  const db = createServiceClient()
  const { data, error } = await db
    .from('tickers_master')
    .select('ticker_symbol, company_name')
    .ilike('ticker_symbol', `${prefix.toUpperCase()}%`)
    .eq('active', true)
    .order('ticker_symbol')
    .limit(limit)
  if (error) throw error
  return (data ?? []) as Pick<TickerRow, 'ticker_symbol' | 'company_name'>[]
}

export async function bulkUpsertTickers(rows: Omit<TickerRow, 'created_at'>[]): Promise<void> {
  const db = createServiceClient()
  // Supabase upsert in batches of 500 to stay within request limits
  const BATCH = 500
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    const { error } = await db
      .from('tickers_master')
      .upsert(batch, { onConflict: 'ticker_symbol' })
    if (error) throw error
  }
}
