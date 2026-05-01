import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { getWatchlist } from '@/lib/repositories/watchlistRepo'
import WatchlistManager from './WatchlistManager'
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
          <div className="flex items-center gap-4">
            <span className="hidden text-xs text-zinc-500 sm:block">{user.email}</span>
            <form action={signOutAction}>
              <button
                type="submit"
                className="text-xs text-zinc-400 hover:text-white transition-colors"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto max-w-lg px-4 py-8">
        <h1 className="mb-6 text-lg font-semibold">My Watchlist</h1>
        <WatchlistManager entries={entries} userEmail={user.email ?? ''} />
      </main>
    </div>
  )
}
