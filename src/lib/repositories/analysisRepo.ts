import { createServiceClient } from '@/lib/supabase/server'

export type AiAnalysis = {
  id: string
  article_id: string
  summary: string | null
  economic_impact: string | null
  material: boolean | null
  confidence: number | null
  provider: string | null
  raw_response: Record<string, unknown> | null
  cost_tokens_in: number | null
  cost_tokens_out: number | null
  created_at: string
}

export type NewAnalysis = {
  article_id: string
  summary?: string | null
  economic_impact?: string | null
  material?: boolean | null
  confidence?: number | null
  provider?: string | null
  raw_response?: Record<string, unknown> | null
  cost_tokens_in?: number | null
  cost_tokens_out?: number | null
}

export async function saveAnalysis(analysis: NewAnalysis): Promise<AiAnalysis> {
  const db = createServiceClient()
  const { data, error } = await db
    .from('ai_analyses')
    .insert(analysis)
    .select()
    .single()
  if (error) throw error
  return data as AiAnalysis
}

export async function countAnalysesToday(): Promise<number> {
  const db = createServiceClient()
  const startOfDay = new Date()
  startOfDay.setUTCHours(0, 0, 0, 0)
  const { count, error } = await db
    .from('ai_analyses')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', startOfDay.toISOString())
  if (error) throw error
  return count ?? 0
}
