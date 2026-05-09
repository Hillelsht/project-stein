import { createServiceClient } from '@/lib/supabase/server'

export type PushHistoryRow = {
  id: string
  user_id: string
  ticker_symbol: string
  signal_id: string | null
  sent_at: string
}

export type NewPushHistory = {
  user_id: string
  ticker_symbol: string
  signal_id?: string | null
}

export async function recordPushSent(entry: NewPushHistory): Promise<void> {
  const db = createServiceClient()
  const { error } = await db.from('push_history').insert(entry)
  if (error) throw error
}

export async function countSentToday(userId: string): Promise<number> {
  const db = createServiceClient()
  const startOfDay = new Date()
  startOfDay.setUTCHours(0, 0, 0, 0)
  const { count, error } = await db
    .from('push_history')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('sent_at', startOfDay.toISOString())
  if (error) throw error
  return count ?? 0
}

export async function wasTickerPushedRecently(
  userId: string,
  tickerSymbol: string,
  withinMinutes: number,
): Promise<boolean> {
  const db = createServiceClient()
  const cutoff = new Date(Date.now() - withinMinutes * 60_000)
  const { count, error } = await db
    .from('push_history')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('ticker_symbol', tickerSymbol)
    .gte('sent_at', cutoff.toISOString())
  if (error) throw error
  return (count ?? 0) > 0
}
