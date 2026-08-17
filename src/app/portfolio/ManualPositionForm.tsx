'use client'

import { useState, useTransition } from 'react'
import { addManualPositionAction, deletePositionAction } from './actions'
import type { Position } from '@/lib/repositories/positionRepo'

/**
 * Manual holdings. These are never touched by the IBKR sync, so they survive
 * every refresh — for assets Flex doesn't report or a broker without an adapter.
 */
export default function ManualPositionForm({ positions }: { positions: Position[] }) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(formData: FormData) {
    setError(null)
    startTransition(async () => {
      const result = await addManualPositionAction(formData)
      if (result.error) setError(result.error)
    })
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      <form action={handleSubmit} className="flex flex-wrap items-end gap-2">
        <label className="flex-1 min-w-[90px]">
          <span className="mb-1 block text-[11px] text-zinc-500">Ticker</span>
          <input
            name="ticker"
            required
            placeholder="AAPL"
            className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 font-mono text-sm uppercase text-white placeholder-zinc-600 focus:border-indigo-500 focus:outline-none"
          />
        </label>
        <label className="w-24">
          <span className="mb-1 block text-[11px] text-zinc-500">Quantity</span>
          <input
            name="quantity"
            type="number"
            step="any"
            required
            placeholder="100"
            className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-sm text-white placeholder-zinc-600 focus:border-indigo-500 focus:outline-none"
          />
        </label>
        <label className="w-28">
          <span className="mb-1 block text-[11px] text-zinc-500">Avg cost</span>
          <input
            name="avg_cost"
            type="number"
            step="any"
            placeholder="optional"
            className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-sm text-white placeholder-zinc-600 focus:border-indigo-500 focus:outline-none"
          />
        </label>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-zinc-700 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-600 disabled:opacity-50"
        >
          {isPending ? 'Adding…' : 'Add'}
        </button>
      </form>

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

      {positions.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-zinc-800 pt-3">
          {positions.map((p) => (
            <li key={p.id} className="flex items-center justify-between text-xs">
              <span className="font-mono">
                {p.ticker_symbol}
                <span className="ml-2 text-zinc-500">
                  {p.quantity}
                  {p.avg_cost !== null ? ` @ ${p.avg_cost}` : ''}
                </span>
              </span>
              <button
                type="button"
                onClick={() => startTransition(() => deletePositionAction(p.id))}
                disabled={isPending}
                className="text-zinc-500 transition-colors hover:text-red-400 disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
