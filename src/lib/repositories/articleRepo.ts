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

export async function markFilterPass(articleId: string): Promise<void> {
  const db = createServiceClient()
  const { error } = await db
    .from('articles')
    .update({ passed_filter: true })
    .eq('id', articleId)
  if (error) throw error
}

export async function getLatestFetchedAt(): Promise<string | null> {
  const db = createServiceClient()
  const { data, error } = await db
    .from('articles')
    .select('fetched_at')
    .order('fetched_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data?.fetched_at as string | undefined) ?? null
}

export async function markFilterReject(articleId: string, reason: string): Promise<void> {
  const db = createServiceClient()
  const { error } = await db
    .from('articles')
    .update({ passed_filter: false, filter_reject_reason: reason })
    .eq('id', articleId)
  if (error) throw error
}
