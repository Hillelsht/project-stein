import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { getWatchlist } from '@/lib/repositories/watchlistRepo'
import WatchlistManager from './WatchlistManager'
import PushToggle from '@/components/PushToggle'
import { signOutAction } from './actions'

export default async function WatchlistPage() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const entries = await getWatchlist(user.id)

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-950 px-4 py-3">
        <div className="mx-auto flex max-w-lg items-center justify-between">
          <span className="text-sm font-semibold tracking-tight">Project Stein</span>
          <nav className="flex items-center gap-4 text-xs">
            <Link href="/" className="text-zinc-400 hover:text-white transition-colors">
              Feed
            </Link>
            <Link href="/watchlist" className="font-semibold text-white">
              Watchlist
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

      {/* Main */}
      <main className="mx-auto max-w-lg px-4 py-8 space-y-8">
        <section>
          <h1 className="mb-6 text-lg font-semibold">My Watchlist</h1>
          <WatchlistManager entries={entries} userEmail={user.email ?? ''} />
        </section>
        <section>
          <h2 className="mb-3 text-sm font-semibold text-zinc-300">Notifications</h2>
          <PushToggle />
        </section>
      </main>
    </div>
  )
}
