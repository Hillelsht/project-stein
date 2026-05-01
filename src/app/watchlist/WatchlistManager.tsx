'use client'

import { useRef, useState, useTransition } from 'react'
import { addTickerAction, removeTickerAction, searchTickersAction } from './actions'
import type { WatchlistEntry } from '@/lib/repositories/watchlistRepo'

type Suggestion = { ticker_symbol: string; company_name: string | null }

export default function WatchlistManager({
  entries,
  userEmail,
}: {
  entries: WatchlistEntry[]
  userEmail: string
}) {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [addError, setAddError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleQueryChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    setQuery(val)
    setAddError(null)
    if (timerRef.current) clearTimeout(timerRef.current)
    if (!val.trim()) { setSuggestions([]); return }
    timerRef.current = setTimeout(async () => {
      const results = await searchTickersAction(val.trim())
      setSuggestions(results)
    }, 250)
  }

  function handleAdd(symbol: string) {
    setQuery('')
    setSuggestions([])
    setAddError(null)
    startTransition(async () => {
      const result = await addTickerAction(symbol)
      if (result.error) setAddError(result.error)
    })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      const symbol = suggestions[0]?.ticker_symbol ?? query.toUpperCase().trim()
      if (symbol) handleAdd(symbol)
    }
    if (e.key === 'Escape') {
      setSuggestions([])
    }
  }

  function handleRemove(symbol: string) {
    startTransition(async () => {
      await removeTickerAction(symbol)
    })
  }

  return (
    <div className="space-y-6">
      {/* Watchlist entries */}
      {entries.length === 0 ? (
        <p className="text-zinc-500 text-sm">Your watchlist is empty. Add a ticker below.</p>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry) => (
            <li
              key={entry.ticker_symbol}
              className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3"
            >
              <span className="font-mono text-sm font-semibold text-white">
                {entry.ticker_symbol}
              </span>
              <button
                onClick={() => handleRemove(entry.ticker_symbol)}
                disabled={isPending}
                className="text-xs text-zinc-500 hover:text-red-400 transition-colors disabled:opacity-40"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Add ticker */}
      <div className="relative">
        <label className="block text-xs font-medium text-zinc-400 mb-2">Add ticker</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={handleQueryChange}
            onKeyDown={handleKeyDown}
            onBlur={() => setTimeout(() => setSuggestions([]), 150)}
            placeholder="e.g. AAPL"
            maxLength={5}
            className="flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-white placeholder-zinc-600 uppercase focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <button
            onClick={() => {
              const symbol = suggestions[0]?.ticker_symbol ?? query.toUpperCase().trim()
              if (symbol) handleAdd(symbol)
            }}
            disabled={!query.trim() || isPending}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Add
          </button>
        </div>

        {/* Autocomplete dropdown */}
        {suggestions.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 shadow-lg">
            {suggestions.map((s) => (
              <li
                key={s.ticker_symbol}
                onMouseDown={() => handleAdd(s.ticker_symbol)}
                className="flex items-center gap-3 cursor-pointer px-3 py-2 hover:bg-zinc-800 first:rounded-t-md last:rounded-b-md"
              >
                <span className="font-mono text-sm font-semibold text-white w-14 shrink-0">
                  {s.ticker_symbol}
                </span>
                <span className="text-xs text-zinc-400 truncate">{s.company_name ?? ''}</span>
              </li>
            ))}
          </ul>
        )}

        {addError && (
          <p className="mt-2 text-xs text-red-400">{addError}</p>
        )}
      </div>
    </div>
  )
}
