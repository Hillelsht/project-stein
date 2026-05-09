import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { getWatchlist } from '@/lib/repositories/watchlistRepo'
import { getRecentSignalsWithContext } from '@/lib/repositories/signalRepo'
import { signOutAction } from './watchlist/actions'
import SignalCard from '@/components/SignalCard'
import FeedToggle from '@/components/FeedToggle'
import LegalFooter from '@/components/LegalFooter'

export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>
}) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { view: viewParam } = await searchParams
  const view: 'watchlist' | 'all' = viewParam === 'all' ? 'all' : 'watchlist'

  const watchlist = await getWatchlist(user.id)
  const watchlistTickers = watchlist.map((w) => w.ticker_symbol)

  const showWatchlistEmptyState =
    view === 'watchlist' && watchlistTickers.length === 0

  const signals = showWatchlistEmptyState
    ? []
    : await getRecentSignalsWithContext(
        view === 'watchlist' ? { tickers: watchlistTickers, limit: 50 } : { limit: 50 },
      )

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <header className="border-b border-zinc-800 bg-zinc-950 px-4 py-3">
        <div className="mx-auto flex max-w-lg items-center justify-between">
          <span className="text-sm font-semibold tracking-tight">Project Stein</span>
          <nav className="flex items-center gap-4 text-xs">
            <Link href="/" className="font-semibold text-white">Feed</Link>
            <Link href="/watchlist" className="text-zinc-400 hover:text-white transition-colors">
              Watchlist
            </Link>
            <Link href="/stats" className="text-zinc-400 hover:text-white transition-colors">
              Stats
            </Link>
            <form action={signOutAction}>
              <button
                type="submit"
                className="text-zinc-400 hover:text-white transition-colors"
              >
                Sign out
              </button>
            </form>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-lg px-4 py-6">
        <FeedToggle view={view} />

        <div className="mt-6 space-y-3">
          {showWatchlistEmptyState ? (
            <p className="text-sm text-zinc-500">
              Your watchlist is empty.{' '}
              <Link href="/watchlist" className="text-indigo-400 hover:text-indigo-300">
                Add tickers
              </Link>{' '}
              to see signals here, or browse{' '}
              <Link href="/?view=all" className="text-indigo-400 hover:text-indigo-300">
                all signals
              </Link>
              .
            </p>
          ) : signals.length === 0 ? (
            <p className="text-sm text-zinc-500">
              No signals yet. Check back after the next ingest cycle.
            </p>
          ) : (
            signals.map((signal) => <SignalCard key={signal.id} signal={signal} />)
          )}
        </div>

        <LegalFooter />
      </main>
    </div>
  )
}
