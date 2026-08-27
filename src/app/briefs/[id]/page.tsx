import Link from 'next/link'
import { notFound } from 'next/navigation'
import Nav from '@/components/Nav'
import BriefView from '@/components/BriefView'
import LegalFooter from '@/components/LegalFooter'
import { getBriefById } from '@/lib/repositories/briefRepo'
import { getRecommendationsForBrief } from '@/lib/repositories/recommendationRepo'

export const dynamic = 'force-dynamic'

const TYPE_LABEL: Record<string, string> = {
  PREMARKET: 'Pre-market brief',
  EVENING: 'Evening wrap',
  ON_DEMAND: 'On-demand brief',
}

export default async function BriefDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const brief = await getBriefById(id)
  if (!brief) notFound()

  const recommendations = await getRecommendationsForBrief(brief.id)

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <Nav active="/briefs" />
      <main className="mx-auto max-w-3xl px-4 py-6">
        <Link
          href="/briefs"
          className="text-xs text-zinc-500 transition-colors hover:text-zinc-300"
        >
          ← Archive
        </Link>

        <div className="mt-3 flex items-baseline justify-between gap-3">
          <h1 className="text-xl font-semibold tracking-tight">
            {TYPE_LABEL[brief.brief_type] ?? 'Brief'}
          </h1>
          <span className="font-mono text-xs text-zinc-500">
            {brief.brief_date}
            {brief.model ? ` · ${brief.model}` : ''}
          </span>
        </div>

        {brief.status !== 'GENERATED' ? (
          <p className="mt-6 text-sm text-zinc-500">
            This brief is {brief.status.toLowerCase()}
            {brief.error ? `: ${brief.error}` : '.'}
          </p>
        ) : (
          <BriefView brief={brief} recommendations={recommendations} />
        )}

        <LegalFooter />
      </main>
    </div>
  )
}
