import { createServiceClient } from '@/lib/supabase/server'

export type BriefType = 'PREMARKET' | 'EVENING' | 'ON_DEMAND'
export type BriefStatus = 'PENDING' | 'GENERATED' | 'FAILED'

/** Validated structured output produced by the model. Shape enforced in briefService. */
export type BriefContent = {
  macro_bullets: string[]
  holdings_reviews: {
    ticker: string
    action: 'HOLD' | 'TRIM' | 'ADD' | 'CLOSE' | 'WATCH'
    rationale: string
  }[]
  rec_updates: {
    recommendation_id: string
    ticker: string
    decision: 'MAINTAIN' | 'CLOSE' | 'TIGHTEN_INVALIDATION'
    note: string
    new_invalidation?: number | null
  }[]
  new_ideas: {
    ticker: string
    direction: 'LONG' | 'SHORT'
    thesis: string
    entry_zone_low: number | null
    entry_zone_high: number | null
    invalidation_price: number
    horizon_trading_days: number
    conviction: number
  }[]
  calendar: { date: string; label: string; ticker?: string | null }[]
}

export type Brief = {
  id: string
  brief_date: string
  brief_type: BriefType
  status: BriefStatus
  content: BriefContent | null
  context_pack: Record<string, unknown> | null
  requested_model: string | null
  model: string | null
  tokens_in: number | null
  tokens_out: number | null
  error: string | null
  attempt_count: number
  generated_at: string | null
  emailed_at: string | null
  pushed_at: string | null
  created_at: string
}

export async function getBrief(
  briefDate: string,
  briefType: BriefType
): Promise<Brief | null> {
  const db = createServiceClient()
  const { data, error } = await db
    .from('briefs')
    .select('*')
    .eq('brief_date', briefDate)
    .eq('brief_type', briefType)
    .maybeSingle()
  if (error) throw error
  return data as Brief | null
}

export async function getBriefById(id: string): Promise<Brief | null> {
  const db = createServiceClient()
  const { data, error } = await db.from('briefs').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data as Brief | null
}

/** Most recent brief that actually produced content. */
export async function getLatestGeneratedBrief(): Promise<Brief | null> {
  const db = createServiceClient()
  const { data, error } = await db
    .from('briefs')
    .select('*')
    .eq('status', 'GENERATED')
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw error
  const rows = data as Brief[]
  return rows.length > 0 ? rows[0] : null
}

export async function listBriefs(limit = 60): Promise<Brief[]> {
  const db = createServiceClient()
  const { data, error } = await db
    .from('briefs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data as Brief[]
}

export async function createBrief(row: {
  brief_date: string
  brief_type: BriefType
  status: BriefStatus
  requested_model: string | null
}): Promise<Brief> {
  const db = createServiceClient()
  const { data, error } = await db.from('briefs').insert(row).select().single()
  if (error) throw error
  return data as Brief
}

export type BriefPatch = Partial<
  Pick<
    Brief,
    | 'status'
    | 'content'
    | 'context_pack'
    | 'model'
    | 'requested_model'
    | 'tokens_in'
    | 'tokens_out'
    | 'error'
    | 'attempt_count'
    | 'generated_at'
    | 'emailed_at'
    | 'pushed_at'
  >
>

export async function updateBrief(id: string, patch: BriefPatch): Promise<Brief> {
  const db = createServiceClient()
  const { data, error } = await db.from('briefs').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data as Brief
}

/** Ops: when did we last successfully generate anything? */
export async function getLatestGeneratedAt(): Promise<string | null> {
  const brief = await getLatestGeneratedBrief()
  return brief?.generated_at ?? null
}

/** Briefs stuck in PENDING past a cutoff — the Actions worker never reported back. */
export async function getStalePendingBriefs(olderThanIso: string): Promise<Brief[]> {
  const db = createServiceClient()
  const { data, error } = await db
    .from('briefs')
    .select('*')
    .eq('status', 'PENDING')
    .lt('created_at', olderThanIso)
  if (error) throw error
  return data as Brief[]
}

/** Cleanup: drop stored context packs older than N days (audit value expires). */
export async function purgeContextPacksOlderThan(days: number): Promise<number> {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()
  const db = createServiceClient()
  const { data, error } = await db
    .from('briefs')
    .update({ context_pack: null })
    .lt('created_at', cutoff)
    .not('context_pack', 'is', null)
    .select('id')
  if (error) throw error
  return (data as { id: string }[] | null)?.length ?? 0
}
