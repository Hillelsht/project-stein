import { createServiceClient } from '@/lib/supabase/server'

export async function hashExists(hash: string): Promise<boolean> {
  const db = createServiceClient()
  const windowStart = new Date()
  windowStart.setHours(windowStart.getHours() - 48)
  const { data, error } = await db
    .from('dedup_hashes')
    .select('hash')
    .eq('hash', hash)
    .gte('created_at', windowStart.toISOString())
    .maybeSingle()
  if (error) throw error
  return data !== null
}

export async function saveHash(hash: string, articleId: string): Promise<void> {
  const db = createServiceClient()
  const { error } = await db
    .from('dedup_hashes')
    .insert({ hash, article_id: articleId })
  // Ignore duplicate hash inserts — article already tracked
  if (error && error.code !== '23505') throw error
}

export async function purgeOlderThan(hours: number): Promise<number> {
  const db = createServiceClient()
  const cutoff = new Date()
  cutoff.setHours(cutoff.getHours() - hours)
  const { error, count } = await db
    .from('dedup_hashes')
    .delete({ count: 'exact' })
    .lt('created_at', cutoff.toISOString())
  if (error) throw error
  return count ?? 0
}
