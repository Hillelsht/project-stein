'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Seed or clear sample data. Useful before any credential exists: it renders
 * the whole UI — brief, scoreboard, portfolio — so the design can be judged
 * without waiting on IBKR or an API key.
 */
export default function DemoControls() {
  const router = useRouter()
  const [message, setMessage] = useState<string | null>(null)
  const [isError, setIsError] = useState(false)
  const [isPending, startTransition] = useTransition()

  async function call(method: 'POST' | 'DELETE') {
    setMessage(null)
    try {
      const res = await fetch('/api/demo', { method })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setIsError(false)
      setMessage(
        method === 'POST'
          ? 'Sample data loaded — check the Brief, Scoreboard and Portfolio tabs.'
          : 'Sample data removed.'
      )
      startTransition(() => router.refresh())
    } catch (err) {
      setIsError(true)
      setMessage(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      <p className="text-sm font-semibold">Sample data</p>
      <p className="mt-1 text-xs text-zinc-400">
        Loads one example brief, three positions, and five scored recommendations so
        you can see the whole app before connecting IBKR or any model. Every row is
        tagged and removable; nothing touches real data.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => call('POST')}
          disabled={isPending}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
        >
          Load sample data
        </button>
        <button
          type="button"
          onClick={() => call('DELETE')}
          disabled={isPending}
          className="rounded-md bg-zinc-700 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-600 disabled:opacity-50"
        >
          Remove
        </button>
      </div>
      {message && (
        <p className={`mt-2 text-xs ${isError ? 'text-red-400' : 'text-emerald-400'}`}>{message}</p>
      )}
    </div>
  )
}
