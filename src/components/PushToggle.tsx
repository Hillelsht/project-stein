'use client'

import { useEffect, useState } from 'react'

type Status = 'unsupported' | 'denied' | 'idle' | 'subscribed' | 'busy' | 'unavailable'

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const buffer = new ArrayBuffer(raw.length)
  const arr = new Uint8Array(buffer)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

export default function PushToggle() {
  const [status, setStatus] = useState<Status>('busy')
  const [error, setError] = useState<string | null>(null)
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY

  useEffect(() => {
    void init()
    async function init() {
      if (!vapidPublicKey) { setStatus('unavailable'); return }
      if (typeof window === 'undefined') return
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        setStatus('unsupported')
        return
      }
      if (Notification.permission === 'denied') {
        setStatus('denied')
        return
      }
      try {
        const reg = await navigator.serviceWorker.register('/sw.js')
        await navigator.serviceWorker.ready
        const existing = await reg.pushManager.getSubscription()
        setStatus(existing ? 'subscribed' : 'idle')
      } catch (err) {
        setError((err as Error).message)
        setStatus('idle')
      }
    }
  }, [vapidPublicKey])

  async function enable() {
    if (!vapidPublicKey) return
    setError(null)
    setStatus('busy')
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setStatus(permission === 'denied' ? 'denied' : 'idle')
        return
      }
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      })
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      })
      if (!res.ok) throw new Error(`Subscribe failed: ${res.status}`)
      setStatus('subscribed')
    } catch (err) {
      setError((err as Error).message)
      setStatus('idle')
    }
  }

  async function disable() {
    setError(null)
    setStatus('busy')
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        })
        await sub.unsubscribe()
      }
      setStatus('idle')
    } catch (err) {
      setError((err as Error).message)
      setStatus('subscribed')
    }
  }

  if (status === 'unavailable') {
    return (
      <p className="text-xs text-zinc-500">
        Push notifications are not configured for this deployment.
      </p>
    )
  }

  if (status === 'unsupported') {
    return (
      <p className="text-xs text-zinc-500">
        Your browser does not support push notifications.
        On iOS, install this site to your Home Screen first (iOS 16.4+).
      </p>
    )
  }

  if (status === 'denied') {
    return (
      <p className="text-xs text-amber-400">
        Notifications are blocked. Enable them in your browser settings, then reload this page.
      </p>
    )
  }

  const label =
    status === 'subscribed' ? 'Disable push notifications'
    : status === 'busy'     ? '…'
    :                         'Enable push notifications'

  const onClick = status === 'subscribed' ? disable : enable
  const disabled = status === 'busy'

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-40 transition-colors"
      >
        {label}
      </button>
      {status === 'subscribed' && (
        <p className="text-xs text-zinc-500">
          You will get a push when a watchlist ticker has a signal of 8/10 or higher.
        </p>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
