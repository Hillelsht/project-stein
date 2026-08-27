import webpush from 'web-push'
import {
  getAllSubscriptions,
  deleteSubscription,
  type PushSubscription,
} from '@/lib/repositories/pushRepo'

let vapidConfigured = false
function configureVapid(): boolean {
  if (vapidConfigured) return true
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT
  if (!publicKey || !privateKey || !subject) {
    console.warn('[push] VAPID keys not configured — skipping notification')
    return false
  }
  webpush.setVapidDetails(subject, publicKey, privateKey)
  vapidConfigured = true
  return true
}

type Payload = { title: string; body: string; url: string; tag?: string }

/** Sends to a set of subscriptions, purging any the browser reports as dead. */
async function deliver(subs: PushSubscription[], payload: Payload): Promise<number> {
  const body = JSON.stringify(payload)
  let delivered = 0

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
        )
        delivered++
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) {
          // Subscription expired — purge it
          await deleteSubscription(sub.endpoint)
          console.log(`[push] removed expired subscription ${sub.endpoint.slice(0, 40)}…`)
        } else {
          console.warn(`[push] send failed (${status ?? '??'}):`, (err as Error).message)
        }
      }
    }),
  )

  return delivered
}

/**
 * Sends one notification to every registered device. Used for brief-ready
 * alerts, which are not per-ticker and have no watchlist to filter on.
 */
export async function sendPushToAllSubscriptions(payload: Payload): Promise<number> {
  if (!configureVapid()) return 0
  const subs = await getAllSubscriptions()
  if (subs.length === 0) {
    console.log('[push] no subscriptions registered')
    return 0
  }
  return deliver(subs, payload)
}
