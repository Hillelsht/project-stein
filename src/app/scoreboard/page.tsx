import Link from 'next/link'
import Nav from '@/components/Nav'
import LegalFooter from '@/components/LegalFooter'
import { computeScoreboard, type ScoreboardBucket } from '@/lib/services/scoringService'

export const dynamic = 'force-dynamic'

const WINDOWS = [
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
  { days: null, label: 'All' },
] as const

function pct(value: number | null, dp = 2): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return `${value > 0 ? '+' : ''}${value.toFixed(dp)}%`
}

function signClass(value: number | null): string {
  if (value === null || value === 0) return 'text-zinc-400'
  return value > 0 ? 'text-emerald-400' : 'text-red-400'
}

const STATUS_LABEL: Record<string, string> = {
  OPEN: 'Open',
  CLOSED_TARGET: 'Hit target',
  CLOSED_INVALIDATED: 'Stopped out',
  CLOSED_HORIZON: 'Held to horizon',
  CLOSED_BY_MODEL: 'Closed by brief',
}

function Tile({
  label,
  value,
  sub,
  valueClass = '',
}: {
  label: string
  value: string
  sub?: string
  valueClass?: string
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-1 font-mono text-2xl font-semibold tabular-nums ${valueClass}`}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-zinc-500">{sub}</div>}
    </div>
  )
}

function BucketRows({ buckets }: { buckets: ScoreboardBucket[] }) {
  return (
    <tbody>
      {buckets.map((b) => (
        <tr key={b.label} className="border-t border-zinc-800">
          <td className="py-2 pr-3 text-zinc-300">{b.label}</td>
          <td className="py-2 pr-3 text-right tabular-nums text-zinc-400">{b.closed}</td>
          <td className="py-2 pr-3 text-right tabular-nums text-zinc-300">
            {b.hit_rate === null ? '—' : `${b.hit_rate.toFixed(0)}%`}
          </td>
          <td className={`py-2 pr-3 text-right tabular-nums ${signClass(b.avg_return)}`}>
            {pct(b.avg_return)}
          </td>
          <td className={`py-2 text-right tabular-nums ${signClass(b.avg_alpha)}`}>
            {pct(b.avg_alpha)}
          </td>
        </tr>
      ))}
    </tbody>
  )
}

export default async function ScoreboardPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>
}) {
  const { window: windowParam } = await searchParams
  const selected =
    WINDOWS.find((w) => w.label.toLowerCase() === (windowParam ?? '').toLowerCase()) ??
    WINDOWS[2]

  const board = await computeScoreboard(selected.days)
  const o = board.overall

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <Nav active="/scoreboard" />
      <main className="mx-auto max-w-3xl px-4 py-6">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold tracking-tight">Scoreboard</h1>
          <div className="flex gap-1">
            {WINDOWS.map((w) => (
              <Link
                key={w.label}
                href={`/scoreboard?window=${w.label.toLowerCase()}`}
                className={`rounded px-2 py-1 text-xs transition-colors ${
                  w.label === selected.label
                    ? 'bg-zinc-800 text-white'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {w.label}
              </Link>
            ))}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Tile
            label="Alpha vs SPY"
            value={pct(o.avg_alpha)}
            valueClass={signClass(o.avg_alpha)}
            sub="average per closed idea"
          />
          <Tile
            label="Avg return"
            value={pct(o.avg_return)}
            valueClass={signClass(o.avg_return)}
            sub={`${o.closed} closed`}
          />
          <Tile
            label="Hit rate"
            value={o.hit_rate === null ? '—' : `${o.hit_rate.toFixed(0)}%`}
            sub={`${o.wins} of ${o.closed}`}
          />
          <Tile label="Open now" value={String(board.open_count)} sub="being tracked" />
        </div>

        {o.closed === 0 ? (
          <p className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 text-sm text-zinc-400">
            No closed recommendations yet in this window. Numbers appear once ideas reach
            their invalidation or horizon — give it a couple of weeks.
          </p>
        ) : (
          <>
            {(board.by_direction.length > 0 || board.by_conviction.length > 0) && (
              <section className="mt-7">
                <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.09em] text-zinc-500">
                  Breakdown
                </h2>
                <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-2">
                  <table className="w-full min-w-[420px] text-xs">
                    <thead>
                      <tr className="text-zinc-500">
                        <th className="py-2 pr-3 text-left font-medium">Group</th>
                        <th className="py-2 pr-3 text-right font-medium">Closed</th>
                        <th className="py-2 pr-3 text-right font-medium">Hit</th>
                        <th className="py-2 pr-3 text-right font-medium">Return</th>
                        <th className="py-2 text-right font-medium">Alpha</th>
                      </tr>
                    </thead>
                    <BucketRows buckets={[...board.by_direction, ...board.by_conviction]} />
                  </table>
                </div>
              </section>
            )}
          </>
        )}

        <section className="mt-7">
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.09em] text-zinc-500">
            Every recommendation
          </h2>
          {board.recent.length === 0 ? (
            <p className="text-sm text-zinc-500">Nothing recorded yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-2">
              <table className="w-full min-w-[560px] text-xs">
                <thead>
                  <tr className="text-zinc-500">
                    <th className="py-2 pr-3 text-left font-medium">Opened</th>
                    <th className="py-2 pr-3 text-left font-medium">Ticker</th>
                    <th className="py-2 pr-3 text-left font-medium">Dir</th>
                    <th className="py-2 pr-3 text-right font-medium">Entry</th>
                    <th className="py-2 pr-3 text-right font-medium">Now</th>
                    <th className="py-2 pr-3 text-right font-medium">Return</th>
                    <th className="py-2 pr-3 text-right font-medium">vs SPY</th>
                    <th className="py-2 text-left font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {board.recent.map((r) => {
                    const alpha =
                      r.current_return_pct !== null && r.benchmark_return_pct !== null
                        ? r.current_return_pct - r.benchmark_return_pct
                        : null
                    return (
                      <tr key={r.id} className="border-t border-zinc-800">
                        <td className="py-2 pr-3 font-mono text-zinc-500">
                          {r.created_at.slice(0, 10)}
                        </td>
                        <td className="py-2 pr-3 font-mono font-semibold">{r.ticker_symbol}</td>
                        <td
                          className={`py-2 pr-3 font-medium ${
                            r.direction === 'LONG' ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {r.direction}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-400">
                          {r.entry_price?.toFixed(2) ?? '—'}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-400">
                          {(r.close_price ?? r.current_price)?.toFixed(2) ?? '—'}
                        </td>
                        <td
                          className={`py-2 pr-3 text-right font-mono tabular-nums ${signClass(
                            r.current_return_pct
                          )}`}
                        >
                          {pct(r.current_return_pct)}
                        </td>
                        <td
                          className={`py-2 pr-3 text-right font-mono tabular-nums ${signClass(alpha)}`}
                        >
                          {pct(alpha)}
                        </td>
                        <td className="py-2 text-zinc-400">
                          {STATUS_LABEL[r.status] ?? r.status}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <p className="mt-5 text-xs leading-relaxed text-zinc-500">
          <strong className="text-zinc-400">Alpha vs SPY</strong> is the number that
          matters: a recommendation&apos;s return minus what SPY did over the same holding
          period. A positive hit rate with negative alpha means the ideas made money but
          you&apos;d have done better just buying the index. Only closed recommendations
          count — open ones are excluded so unrealized winners can&apos;t flatter the record.
        </p>

        <LegalFooter />
      </main>
    </div>
  )
}
