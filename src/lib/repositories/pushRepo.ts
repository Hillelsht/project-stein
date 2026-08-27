import { createServiceClient } from '@/lib/supabase/server'

export type PushSubscription = {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
  created_at: string
}

export type NewPushSubscription = {
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
}

/**
 * Every subscription in the system. Stein 2.0 is single-user, so a brief
 * notification goes to every registered device rather than being scoped by user.
 */
export async function getAllSubscriptions(): Promise<PushSubscription[]> {
  const db = createServiceClient()
  const { data, error } = await db.from('push_subscriptions').select('*')
  if (error) throw error
  return data as PushSubscription[]
}

export async function saveSubscription(sub: NewPushSubscription): Promise<void> {
  const db = createServiceClient()
  const { error } = await db
    .from('push_subscriptions')
    .upsert(sub, { onConflict: 'endpoint' })
  if (error) throw error
}

export async function deleteSubscription(endpoint: string): Promise<void> {
  const db = createServiceClient()
  const { error } = await db
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint)
  if (error) throw error
}
