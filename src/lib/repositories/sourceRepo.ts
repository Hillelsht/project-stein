import { createServiceClient } from '@/lib/supabase/server'

export type Source = {
  id: string
  name: string
  rss_url: string
  priority_tier: 1 | 2
  active: boolean
  last_polled_at: string | null
  created_at: string
}

export async function getActiveSources(): Promise<Source[]> {
  const db = createServiceClient()
  const { data, error } = await db
    .from('sources')
    .select('*')
    .eq('active', true)
    .order('priority_tier', { ascending: true })
  if (error) throw error
  return data as Source[]
}

export async function updateLastPolled(sourceId: string): Promise<void> {
  const db = createServiceClient()
  const { error } = await db
    .from('sources')
    .update({ last_polled_at: new Date().toISOString() })
    .eq('id', sourceId)
  if (error) throw error
}
