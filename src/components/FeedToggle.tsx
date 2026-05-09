import Link from 'next/link'

export default function FeedToggle({ view }: { view: 'watchlist' | 'all' }) {
  const base =
    'flex-1 rounded-md px-3 py-1.5 text-center text-xs font-medium transition-colors'
  const active = 'bg-zinc-800 text-white'
  const inactive = 'text-zinc-400 hover:text-white'

  return (
    <div className="flex gap-1 rounded-lg border border-zinc-800 bg-zinc-900/60 p-1">
      <Link
        href="/"
        className={`${base} ${view === 'watchlist' ? active : inactive}`}
      >
        Watchlist
      </Link>
      <Link
        href="/?view=all"
        className={`${base} ${view === 'all' ? active : inactive}`}
      >
        All signals
      </Link>
    </div>
  )
}
