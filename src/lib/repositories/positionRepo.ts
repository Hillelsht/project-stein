import { createServiceClient } from '@/lib/supabase/server'

export type PositionSource = 'flex' | 'manual'

export type Position = {
  id: string
  broker: string
  ticker_symbol: string
  quantity: number
  avg_cost: number | null
  currency: string
  market_value: number | null
  unrealized_pnl: number | null
  asset_class: string | null
  source: PositionSource
  as_of: string | null
  updated_at: string
  created_at: string
}

export type NewPosition = Omit<Position, 'id' | 'updated_at' | 'created_at'>

export async function getPositions(): Promise<Position[]> {
  const db = createServiceClient()
  const { data, error } = await db
    .from('positions')
    .select('*')
    .order('ticker_symbol', { ascending: true })
  if (error) throw error
  return data as Position[]
}

export async function getPositionTickers(): Promise<string[]> {
  const positions = await getPositions()
  return [...new Set(positions.map((p) => p.ticker_symbol))]
}

/** Number of synced rows for a broker — used by the sync's empty-statement guard. */
export async function countBySource(broker: string, source: PositionSource): Promise<number> {
  const db = createServiceClient()
  const { count, error } = await db
    .from('positions')
    .select('*', { count: 'exact', head: true })
    .eq('broker', broker)
    .eq('source', source)
  if (error) throw error
  return count ?? 0
}

export async function upsertPositions(rows: NewPosition[]): Promise<number> {
  if (rows.length === 0) return 0
  const db = createServiceClient()
  const { error } = await db
    .from('positions')
    .upsert(
      rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })),
      { onConflict: 'broker,ticker_symbol' }
    )
  if (error) throw error
  return rows.length
}

/**
 * Deletes synced rows for a broker whose ticker is absent from `keepTickers`.
 * Only touches rows with the given source, so manually entered positions
 * survive every sync.
 */
export async function deleteMissingSyncedPositions(
  broker: string,
  source: PositionSource,
  keepTickers: string[]
): Promise<number> {
  const db = createServiceClient()
  let query = db
    .from('positions')
    .delete()
    .eq('broker', broker)
    .eq('source', source)

  if (keepTickers.length > 0) {
    // PostgREST list literal — symbols are [A-Z0-9.-] so no quoting needed.
    query = query.not('ticker_symbol', 'in', `(${keepTickers.join(',')})`)
  }

  const { data, error } = await query.select('id')
  if (error) throw error
  return (data as { id: string }[] | null)?.length ?? 0
}

export async function upsertManualPosition(
  row: Omit<NewPosition, 'source' | 'broker'> & { broker?: string }
): Promise<void> {
  const db = createServiceClient()
  const { error } = await db.from('positions').upsert(
    {
      ...row,
      broker: row.broker ?? 'manual',
      source: 'manual' as const,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'broker,ticker_symbol' }
  )
  if (error) throw error
}

export async function deletePosition(id: string): Promise<void> {
  const db = createServiceClient()
  const { error } = await db.from('positions').delete().eq('id', id)
  if (error) throw error
}

/** Most recent statement date across synced rows — powers the ops staleness check. */
export async function getLatestSyncedAt(): Promise<string | null> {
  const db = createServiceClient()
  const { data, error } = await db
    .from('positions')
    .select('updated_at')
    .eq('source', 'flex')
    .order('updated_at', { ascending: false })
    .limit(1)
  if (error) throw error
  const rows = data as { updated_at: string }[]
  return rows.length > 0 ? rows[0].updated_at : null
}
