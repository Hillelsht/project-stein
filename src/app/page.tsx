import Link from 'next/link'
import Nav from '@/components/Nav'
import BriefView from '@/components/BriefView'
import RunNowPanel from '@/components/RunNowPanel'
import LegalFooter from '@/components/LegalFooter'
import OpsBanner from '@/components/OpsBanner'
import { getLatestGeneratedBrief } from '@/lib/repositories/briefRepo'
import { getRecommendationsForBrief } from '@/lib/repositories/recommendationRepo'
import { getSetting } from '@/lib/repositories/settingsRepo'
import { DEFAULT_MODEL_ID, listModels } from '@/lib/services/modelRegistry'
import { toDateKey } from '@/lib/marketCalendar'

export const dynamic = 'force-dynamic'

const TYPE_LABEL: Record<string, string> = {
  PREMARKET: 'Pre-market brief',
  EVENING: 'Evening wrap',
  ON_DEMAND: 'On-demand brief',
}

export default async function HomePage() {
  const brief = await getLatestGeneratedBrief()
  const [recommendations, defaultModel] = await Promise.all([
    brief ? getRecommendationsForBrief(brief.id) : Promise.resolve([]),
    getSetting<string>('default_brief_model'),
  ])

  const today = toDateKey(new Date())
  const isStale = brief ? brief.brief_date !== today : false

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <Nav active="/" />

      <main className="mx-auto max-w-3xl px-4 py-6">
        <OpsBanner />

        <div className="mb-4">
          <RunNowPanel
            models={listModels()}
            defaultModelId={defaultModel ?? DEFAULT_MODEL_ID}
          />
        </div>

        {!brief ? (
          <div className="mt-8 rounded-lg border border-zinc-800 bg-zinc-900/60 p-6 text-center">
            <p className="text-sm text-zinc-300">No brief yet.</p>
            <p className="mt-1 text-xs text-zinc-500">
              Scheduled briefs run pre-market and after the close on weekdays, or
              press <span className="text-zinc-300">Run now</span> above.
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <h1 className="text-xl font-semibold tracking-tight">
                {TYPE_LABEL[brief.brief_type] ?? 'Brief'}
              </h1>
              <span className="font-mono text-xs text-zinc-500">
                {brief.brief_date}
                {brief.model ? ` · ${brief.model}` : ''}
              </span>
            </div>

            {isStale && (
              <p className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                This is the most recent brief ({brief.brief_date}), not today&apos;s.
              </p>
            )}

            <BriefView brief={brief} recommendations={recommendations} />

            <div className="mt-8 border-t border-zinc-800 pt-4">
              <Link
                href="/scoreboard"
                className="text-xs text-indigo-400 transition-colors hover:text-indigo-300"
              >
                Has any of this worked? → Scoreboard
              </Link>
            </div>
          </>
        )}

        <LegalFooter />
      </main>
    </div>
  )
}
