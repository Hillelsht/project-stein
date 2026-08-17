import { createServiceClient } from '@/lib/supabase/server'

export type Article = {
  id: string
  source_id: string
  title: string
  url: string
  published_at: string | null
  fetched_at: string
  raw_content: string | null
  passed_filter: boolean | null
  filter_reject_reason: string | null
  created_at: string
}

export type NewArticle = {
  source_id: string
  title: string
  url: string
  published_at?: string | null
  raw_content?: string | null
}

export async function saveArticle(article: NewArticle): Promise<Article | null> {
  const db = createServiceClient()
  const { data, error } = await db
    .from('articles')
    .insert(article)
    .select()
    .single()
  // Unique URL violation — already stored, not an error for callers
  if (error?.code === '23505') return null
  if (error) throw error
  return data as Article
}

export async function getArticleByUrl(url: string): Promise<Article | null> {
  const db = createServiceClient()
  const { data, error } = await db
    .from('articles')
    .select('*')
    .eq('url', url)
    .maybeSingle()
  if (error) throw error
  return data as Article | null
}

export async function getUnanalyzedArticles(limit: number): Promise<Article[]> {
  const db = createServiceClient()
  const { data, error } = await db
    .from('articles')
    .select('*')
    .is('passed_filter', null)
    .order('fetched_at', { ascending: true })
    .limit(limit)
  if (error) throw error
  return data as Article[]
}

export type ArticleWithSource = Article & {
  sources: { name: string } | null
}

/**
 * Articles that passed the pre-filter within the last N hours — the news the
 * brief context pack is assembled from.
 */
export async function getFilteredArticlesSince(
  hoursBack: number,
  limit: number
): Promise<ArticleWithSource[]> {
  const since = new Date(Date.now() - hoursBack * 3_600_000).toISOString()
  const db = createServiceClient()
  const { data, error } = await db
    .from('articles')
    .select('*, sources(name)')
    .eq('passed_filter', true)
    .gte('fetched_at', since)
    .order('fetched_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data as ArticleWithSource[]
}

/**
 * Drops rejected articles past a retention window. Passed articles are kept —
 * they are the brief's news history and are cheap by comparison.
 */
export async function purgeRejectedOlderThan(days: number): Promise<number> {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()
  const db = createServiceClient()
  const { data, error } = await db
    .from('articles')
    .delete()
    .eq('passed_filter', false)
    .lt('fetched_at', cutoff)
    .select('id')
  if (error) throw error
  return (data as { id: string }[] | null)?.length ?? 0
}

export async function markFilterPass(articleId: string): Promise<void> {
  const db = createServiceClient()
  const { error } = await db
    .from('articles')
    .update({ passed_filter: true })
    .eq('id', articleId)
  if (error) throw error
}

export async function markFilterReject(articleId: string, reason: string): Promise<void> {
  const db = createServiceClient()
  const { error } = await db
    .from('articles')
    .update({ passed_filter: false, filter_reject_reason: reason })
    .eq('id', articleId)
  if (error) throw error
}
