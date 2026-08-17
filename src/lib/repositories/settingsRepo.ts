import { createServiceClient } from '@/lib/supabase/server'

/**
 * Key/value store for owner preferences (e.g. `default_brief_model`), so a new
 * preference is a row rather than a migration.
 */

export async function getSetting<T>(key: string): Promise<T | null> {
  const db = createServiceClient()
  const { data, error } = await db.from('settings').select('value').eq('key', key).maybeSingle()
  if (error) throw error
  return (data as { value: T } | null)?.value ?? null
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  const db = createServiceClient()
  const { error } = await db
    .from('settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) throw error
}
