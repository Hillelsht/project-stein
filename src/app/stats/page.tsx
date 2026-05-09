import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { computeStats } from '@/lib/services/validationService'
import { signOutAction } from '../watchlist/actions'
import LegalFooter from '@/components/LegalFooter'
import OpsBanner from '@/components/OpsBanner'

const WINDOWS = [7, 30, 60, 90] as const
type Window = (typeof WINDOWS)[number]

function clampDays(value: string | undefined): Window {
  const n = Number(value)
  return (WINDOWS as readonly number[]).includes(n) ? (n as Window) : 30
}

function fmtPct(value: number | null): string {
  if (value === null) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}

function fmtRate(value: number | null): string {
  if (value === null) return '—'
  return `${(value * 100).toFixed(0)}%`
}

function returnClass(value: number | null): string {
  if (value === null || value === 0) return 'text-zinc-400'
  return value > 0 ? 'text-emerald-400' : 'text-red-400'
}

const sentimentClass: Record<string, string> = {
  BULLISH: 'text-emerald-400',
  BEARISH: 'text-red-400',
  NEUTRAL: 'text-zinc-400',
}

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>
}) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { days: daysParam } = await searchParams
  const days = clampDays(daysParam)
  const buckets = await computeStats(days)

  const totalSignals = buckets.reduce((sum, b) => sum + b.count, 0)
  const validatedSignals = buckets.reduce(
    (sum, b) => sum + (b.mean_return_1d !== null ? b.count : 0),
    0,
  )

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <header className="border-b border-zinc-800 bg-zinc-950 px-4 py-3">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <span className="text-sm font-semibold tracking-tight">Project Stein</span>
          <nav className="flex items-center gap-4 text-xs">
            <Link href="/" className="text-zinc-400 hover:text-white transition-colors">Feed</Link>
            <Link href="/watchlist" className="text-zinc-400 hover:text-white transition-colors">Watchlist</Link>
            <Link href="/stats" className="font-semibold text-white">Stats</Link>
            <form action={signOutAction}>
              <button type="submit" className="text-zinc-400 hover:text-white transition-colors">
                Sign out
              </button>
            </form>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6">
        <div className="mb-4">
          <OpsBanner />
        </div>
        <div className="mb-4 flex items-baseline justify-between">
          <h1 className="text-lg font-semibold">Validation</h1>
          <div className="flex gap-1 rounded-lg border border-zinc-800 bg-zinc-900/60 p-1 text-xs">
            {WINDOWS.map((w) => (
              <Link
                key={w}
                href={`/stats?days=${w}`}
                className={`rounded-md px-2.5 py-1 ${
                  days === w ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white'
                }`}
              >
                {w}d
              </Link>
            ))}
          </div>
        </div>

        <p className="mb-4 text-xs text-zinc-500">
          {totalSignals} signals in the last {days} days
          {totalSignals > 0 && (
            <> · {validatedSignals} have a 1-day return</>
          )}
          .
        </p>

        {buckets.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No signals in this window yet. Stats appear after the validate cron has had a chance
            to fetch closing prices for at least one signal.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900 text-xs uppercase text-zinc-400">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Sentiment</th>
                  <th className="px-3 py-2 text-left font-medium">Score</th>
                  <th className="px-3 py-2 text-right font-medium">N</th>
                  <th className="px-3 py-2 text-right font-medium">Mean 1d</th>
                  <th className="px-3 py-2 text-right font-medium">Mean 3d</th>
                  <th className="px-3 py-2 text-right font-medium">Hit 1d</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {buckets.map((b) => (
                  <tr key={`${b.sentiment}-${b.score_bucket}`}>
                    <td className={`px-3 py-2 font-semibold ${sentimentClass[b.sentiment] ?? ''}`}>
                      {b.sentiment}
                    </td>
                    <td className="px-3 py-2 font-mono text-zinc-300">{b.score_bucket}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-zinc-300">{b.count}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${returnClass(b.mean_return_1d)}`}>
                      {fmtPct(b.mean_return_1d)}
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums ${returnClass(b.mean_return_3d)}`}>
                      {fmtPct(b.mean_return_3d)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-zinc-300">
                      {fmtRate(b.hit_rate_1d)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-4 text-xs text-zinc-500 leading-relaxed">
          <strong className="text-zinc-400">How to read:</strong> rows are buckets of
          (sentiment × score). <em>Mean 1d</em> and <em>Mean 3d</em> are the average
          percentage price change for the ticker over that horizon, computed only on signals
          old enough to have settled. <em>Hit 1d</em> is the share of signals in the bucket
          whose 1-day return was positive — for BULLISH this is the hit rate; for BEARISH a
          *low* hit rate means the LLM was right. The MVP target after 60 days: BULLISH 8-10
          should have a positive Mean 1d.
        </p>

        <LegalFooter />
      </main>
    </div>
  )
}
