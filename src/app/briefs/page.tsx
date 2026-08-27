import Link from 'next/link'
import Nav from '@/components/Nav'
import LegalFooter from '@/components/LegalFooter'
import { listBriefs } from '@/lib/repositories/briefRepo'

export const dynamic = 'force-dynamic'

const TYPE_LABEL: Record<string, string> = {
  PREMARKET: 'Pre-market',
  EVENING: 'Evening',
  ON_DEMAND: 'On demand',
}

const STATUS_STYLE: Record<string, string> = {
  GENERATED: 'bg-emerald-500/15 text-emerald-400',
  PENDING: 'bg-indigo-500/15 text-indigo-400',
  FAILED: 'bg-red-500/15 text-red-400',
}

export default async function BriefsPage() {
  const briefs = await listBriefs(60)

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <Nav active="/briefs" />
      <main className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="text-xl font-semibold tracking-tight">Archive</h1>
        <p className="mt-1 text-xs text-zinc-500">The last {briefs.length} briefs.</p>

        {briefs.length === 0 ? (
          <p className="mt-6 text-sm text-zinc-500">Nothing here yet.</p>
        ) : (
          <ul className="mt-5 space-y-2">
            {briefs.map((b) => {
              const ideas = b.content?.new_ideas?.length ?? 0
              const row = (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3">
                  <div className="min-w-0">
                    <div className="font-mono text-sm">{b.brief_date}</div>
                    <div className="mt-0.5 truncate text-xs text-zinc-500">
                      {TYPE_LABEL[b.brief_type] ?? b.brief_type}
                      {b.model ? ` · ${b.model}` : ''}
                      {b.status === 'GENERATED'
                        ? ` · ${ideas} idea${ideas === 1 ? '' : 's'}`
                        : ''}
                      {b.status === 'FAILED' && b.error ? ` · ${b.error.slice(0, 60)}` : ''}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                      STATUS_STYLE[b.status] ?? 'bg-zinc-800 text-zinc-300'
                    }`}
                  >
                    {b.status}
                  </span>
                </div>
              )

              return (
                <li key={b.id}>
                  {b.status === 'GENERATED' ? (
                    <Link href={`/briefs/${b.id}`} className="block transition-opacity hover:opacity-80">
                      {row}
                    </Link>
                  ) : (
                    row
                  )}
                </li>
              )
            })}
          </ul>
        )}

        <LegalFooter />
      </main>
    </div>
  )
}
