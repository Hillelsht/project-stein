import Nav from '@/components/Nav'
import LegalFooter from '@/components/LegalFooter'
import OpsBanner from '@/components/OpsBanner'
import PushToggle from '@/components/PushToggle'
import WatchlistManager from './WatchlistManager'
import ManualPositionForm from './ManualPositionForm'
import { createServerClient } from '@/lib/supabase/server'
import { getPositions } from '@/lib/repositories/positionRepo'
import { getWatchlist } from '@/lib/repositories/watchlistRepo'

export const dynamic = 'force-dynamic'

function money(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function signClass(value: number | null): string {
  if (value === null || value === 0) return 'text-zinc-400'
  return value > 0 ? 'text-emerald-400' : 'text-red-400'
}

function relativeAge(iso: string | null): string {
  if (!iso) return 'never'
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export default async function PortfolioPage() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null // auth enforced by src/proxy.ts

  const [positions, watchlist] = await Promise.all([getPositions(), getWatchlist(user.id)])

  const synced = positions.filter((p) => p.source === 'flex')
  const lastSync = synced.length
    ? synced.map((p) => p.updated_at).sort().reverse()[0]
    : null
  const totalValue = positions.reduce((sum, p) => sum + (p.market_value ?? 0), 0)
  const totalPnl = positions.reduce((sum, p) => sum + (p.unrealized_pnl ?? 0), 0)

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <Nav active="/portfolio" />
      <main className="mx-auto max-w-3xl px-4 py-6">
        <OpsBanner />

        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-xl font-semibold tracking-tight">Portfolio</h1>
          <span className="text-xs text-zinc-500">
            IBKR synced {relativeAge(lastSync)}
          </span>
        </div>

        {positions.length === 0 ? (
          <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
            <p className="text-sm text-zinc-300">No positions yet.</p>
            <p className="mt-1 text-xs text-zinc-500">
              Set <span className="font-mono">IBKR_FLEX_TOKEN</span> and{' '}
              <span className="font-mono">IBKR_FLEX_QUERY_ID</span> to sync automatically,
              or add holdings by hand below.
            </p>
          </div>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
                <div className="text-[11px] uppercase tracking-wide text-zinc-500">
                  Market value
                </div>
                <div className="mt-1 font-mono text-xl font-semibold tabular-nums">
                  {money(totalValue)}
                </div>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
                <div className="text-[11px] uppercase tracking-wide text-zinc-500">
                  Unrealized P&amp;L
                </div>
                <div
                  className={`mt-1 font-mono text-xl font-semibold tabular-nums ${signClass(totalPnl)}`}
                >
                  {totalPnl > 0 ? '+' : ''}
                  {money(totalPnl)}
                </div>
              </div>
            </div>

            <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-2">
              <table className="w-full min-w-[520px] text-xs">
                <thead>
                  <tr className="text-zinc-500">
                    <th className="py-2 pr-3 text-left font-medium">Ticker</th>
                    <th className="py-2 pr-3 text-right font-medium">Qty</th>
                    <th className="py-2 pr-3 text-right font-medium">Avg cost</th>
                    <th className="py-2 pr-3 text-right font-medium">Value</th>
                    <th className="py-2 pr-3 text-right font-medium">P&amp;L</th>
                    <th className="py-2 text-left font-medium">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p) => (
                    <tr key={p.id} className="border-t border-zinc-800">
                      <td className="py-2 pr-3 font-mono font-semibold">{p.ticker_symbol}</td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-300">
                        {p.quantity}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-400">
                        {money(p.avg_cost)}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-300">
                        {money(p.market_value)}
                      </td>
                      <td
                        className={`py-2 pr-3 text-right font-mono tabular-nums ${signClass(p.unrealized_pnl)}`}
                      >
                        {p.unrealized_pnl !== null && p.unrealized_pnl > 0 ? '+' : ''}
                        {money(p.unrealized_pnl)}
                      </td>
                      <td className="py-2 text-zinc-500">
                        {p.source === 'flex' ? p.broker : 'manual'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <section className="mt-7">
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.09em] text-zinc-500">
            Add a position by hand
          </h2>
          <ManualPositionForm positions={positions.filter((p) => p.source === 'manual')} />
        </section>

        <section className="mt-7">
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.09em] text-zinc-500">
            Watchlist
          </h2>
          <p className="mb-2 text-xs text-zinc-500">
            Tickers you don&apos;t own but want the brief to cover.
          </p>
          <WatchlistManager entries={watchlist} />
        </section>

        <section className="mt-7">
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.09em] text-zinc-500">
            Notifications
          </h2>
          <PushToggle />
        </section>

        <LegalFooter />
      </main>
    </div>
  )
}
