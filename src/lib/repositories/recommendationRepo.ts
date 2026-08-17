import { createServiceClient } from '@/lib/supabase/server'

export type RecDirection = 'LONG' | 'SHORT'

export type RecStatus =
  | 'OPEN'
  | 'CLOSED_TARGET'
  | 'CLOSED_INVALIDATED'
  | 'CLOSED_HORIZON'
  | 'CLOSED_BY_MODEL'

export type Recommendation = {
  id: string
  brief_id: string
  ticker_symbol: string
  direction: RecDirection
  thesis: string
  entry_zone_low: number | null
  entry_zone_high: number | null
  invalidation_price: number
  horizon_trading_days: number
  horizon_date: string
  conviction: number
  status: RecStatus
  entry_price: number | null
  benchmark_entry_price: number | null
  current_price: number | null
  current_return_pct: number | null
  benchmark_return_pct: number | null
  last_priced_at: string | null
  closed_at: string | null
  close_price: number | null
  closed_by_brief_id: string | null
  close_note: string | null
  created_at: string
}

export type NewRecommendation = Omit<
  Recommendation,
  | 'id'
  | 'created_at'
  | 'status'
  | 'current_price'
  | 'current_return_pct'
  | 'benchmark_return_pct'
  | 'last_priced_at'
  | 'closed_at'
  | 'close_price'
  | 'closed_by_brief_id'
  | 'close_note'
>

export async function createRecommendations(
  rows: NewRecommendation[]
): Promise<Recommendation[]> {
  if (rows.length === 0) return []
  const db = createServiceClient()
  const { data, error } = await db.from('recommendations').insert(rows).select()
  if (error) throw error
  return data as Recommendation[]
}

/** Only OPEN rows — the nightly scoring job never walks closed history. */
export async function getOpenRecommendations(): Promise<Recommendation[]> {
  const db = createServiceClient()
  const { data, error } = await db
    .from('recommendations')
    .select('*')
    .eq('status', 'OPEN')
    .order('created_at', { ascending: true })
  if (error) throw error
  return data as Recommendation[]
}

export type PricingPatch = {
  current_price: number | null
  current_return_pct: number | null
  benchmark_return_pct: number | null
  last_priced_at: string
  status?: RecStatus
  closed_at?: string
  close_price?: number
  close_note?: string
}

export async function applyPricing(id: string, patch: PricingPatch): Promise<void> {
  const db = createServiceClient()
  const { error } = await db.from('recommendations').update(patch).eq('id', id)
  if (error) throw error
}

export async function closeRecommendation(
  id: string,
  args: {
    status: RecStatus
    close_price: number | null
    closed_by_brief_id?: string
    close_note?: string
  }
): Promise<void> {
  const db = createServiceClient()
  const { error } = await db
    .from('recommendations')
    .update({
      status: args.status,
      close_price: args.close_price,
      closed_at: new Date().toISOString(),
      closed_by_brief_id: args.closed_by_brief_id ?? null,
      close_note: args.close_note ?? null,
    })
    .eq('id', id)
  if (error) throw error
}

export async function updateInvalidation(id: string, price: number): Promise<void> {
  const db = createServiceClient()
  const { error } = await db
    .from('recommendations')
    .update({ invalidation_price: price })
    .eq('id', id)
  if (error) throw error
}

export async function getRecommendationHistory(limit = 200): Promise<Recommendation[]> {
  const db = createServiceClient()
  const { data, error } = await db
    .from('recommendations')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data as Recommendation[]
}

export async function getRecommendationsForBrief(briefId: string): Promise<Recommendation[]> {
  const db = createServiceClient()
  const { data, error } = await db
    .from('recommendations')
    .select('*')
    .eq('brief_id', briefId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data as Recommendation[]
}

/** All recommendations created on/after a cutoff — powers the scoreboard windows. */
export async function getRecommendationsSince(sinceIso: string): Promise<Recommendation[]> {
  const db = createServiceClient()
  const { data, error } = await db
    .from('recommendations')
    .select('*')
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as Recommendation[]
}

/** Oldest `last_priced_at` among OPEN recs — ops staleness signal. */
export async function getStalestOpenPricedAt(): Promise<string | null> {
  const db = createServiceClient()
  const { data, error } = await db
    .from('recommendations')
    .select('last_priced_at')
    .eq('status', 'OPEN')
    .order('last_priced_at', { ascending: true, nullsFirst: true })
    .limit(1)
  if (error) throw error
  const rows = data as { last_priced_at: string | null }[]
  return rows.length > 0 ? rows[0].last_priced_at : null
}
