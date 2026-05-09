import webpush from 'web-push'
import { getSubscriptionsForUsers, deleteSubscription } from '@/lib/repositories/pushRepo'
import { getUsersWatchingTicker } from '@/lib/repositories/watchlistRepo'
import {
  countSentToday,
  recordPushSent,
  wasTickerPushedRecently,
} from '@/lib/repositories/pushHistoryRepo'
import type { MarketSignal } from '@/lib/repositories/signalRepo'

const SCORE_THRESHOLD = 8
const DAILY_PUSH_CAP = 10
const TICKER_DEDUP_MINUTES = 30

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

async function sendToUser(userId: string, payload: Payload, signal: MarketSignal): Promise<void> {
  const subs = await getSubscriptionsForUsers([userId])
  if (subs.length === 0) return

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

  if (delivered > 0) {
    await recordPushSent({
      user_id: userId,
      ticker_symbol: signal.ticker_symbol,
      signal_id: signal.id,
    })
  }
}

export async function notifyForSignal(signal: MarketSignal, summary: string): Promise<void> {
  if (signal.sentiment_score < SCORE_THRESHOLD) return
  if (!configureVapid()) return

  const watchers = await getUsersWatchingTicker(signal.ticker_symbol)
  if (watchers.length === 0) return

  const payload: Payload = {
    title: `${signal.ticker_symbol} · ${signal.sentiment} · ${signal.sentiment_score}/10`,
    body: summary.slice(0, 200),
    url: `/?highlight=${signal.id}`,
    tag: signal.ticker_symbol,
  }

  for (const userId of watchers) {
    if (await wasTickerPushedRecently(userId, signal.ticker_symbol, TICKER_DEDUP_MINUTES)) {
      continue
    }
    if ((await countSentToday(userId)) >= DAILY_PUSH_CAP) {
      continue
    }
    await sendToUser(userId, payload, signal)
  }
}
