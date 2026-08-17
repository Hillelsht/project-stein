'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { runBriefNowAction, setDefaultModelAction, type RunBriefState } from '@/app/actions'
import type { ModelEntry } from '@/lib/services/modelRegistry'

/**
 * Generate a brief on demand with a chosen model.
 *
 * The one client component in the app. It has to be: `actions`-runner models
 * complete asynchronously in GitHub Actions, so the panel polls a status
 * endpoint until the brief flips to GENERATED.
 */

const POLL_INTERVAL_MS = 6000
const POLL_TIMEOUT_MS = 6 * 60 * 1000

export default function RunNowPanel({
  models,
  defaultModelId,
}: {
  models: ModelEntry[]
  defaultModelId: string
}) {
  const router = useRouter()
  const [selected, setSelected] = useState(defaultModelId)
  const [state, setState] = useState<RunBriefState | null>(null)
  const [waiting, setWaiting] = useState(false)
  const [isPending, startTransition] = useTransition()

  const model = models.find((m) => m.id === selected) ?? models[0]
  const busy = isPending || waiting

  async function pollUntilReady(briefId: string) {
    const deadline = Date.now() + POLL_TIMEOUT_MS
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
      try {
        const res = await fetch(`/api/briefs/${briefId}/status`, { cache: 'no-store' })
        if (!res.ok) continue
        const data = (await res.json()) as { status?: string; error?: string }
        if (data.status === 'GENERATED') {
          setWaiting(false)
          setState({ ok: true, message: 'Brief ready.' })
          router.refresh()
          return
        }
        if (data.status === 'FAILED') {
          setWaiting(false)
          setState({ ok: false, message: data.error ?? 'The worker reported a failure.' })
          return
        }
      } catch {
        // Transient network error while polling — keep waiting.
      }
    }
    setWaiting(false)
    setState({
      ok: false,
      message: 'Still running after 6 minutes. Check the GitHub Actions tab.',
    })
  }

  function handleRun() {
    setState(null)
    startTransition(async () => {
      const result = await runBriefNowAction(selected)
      setState(result)
      if (result.ok && result.pending && result.briefId) {
        setWaiting(true)
        void pollUntilReady(result.briefId)
      } else if (result.ok) {
        router.refresh()
      }
    })
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={busy}
          className="flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-sm text-white disabled:opacity-50"
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
              {m.runner === 'actions' ? ' (subscription)' : ''}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={handleRun}
          disabled={busy}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Running…' : 'Run now'}
        </button>
      </div>

      {model?.note && !state && (
        <p className="mt-2 text-xs text-zinc-500">{model.note}</p>
      )}

      {waiting && (
        <p className="mt-2 text-xs text-indigo-400">
          Waiting for the GitHub Actions worker — this usually takes 2–3 minutes.
        </p>
      )}

      {state && !waiting && (
        <p className={`mt-2 text-xs ${state.ok ? 'text-emerald-400' : 'text-red-400'}`}>
          {state.message}
        </p>
      )}

      {selected !== defaultModelId && (
        <button
          type="button"
          onClick={() => startTransition(() => setDefaultModelAction(selected))}
          disabled={busy}
          className="mt-2 text-xs text-zinc-500 underline underline-offset-2 transition-colors hover:text-zinc-300 disabled:opacity-50"
        >
          Use {model?.label} for scheduled briefs too
        </button>
      )}
    </div>
  )
}
