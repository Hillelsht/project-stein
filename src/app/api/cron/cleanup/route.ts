import { NextRequest, NextResponse } from 'next/server'
import { purgeOlderThan } from '@/lib/repositories/dedupRepo'
import { purgeRejectedOlderThan } from '@/lib/repositories/articleRepo'
import { purgeContextPacksOlderThan } from '@/lib/repositories/briefRepo'

export const maxDuration = 60

const DEDUP_HOURS = 48
const CONTEXT_PACK_DAYS = 30
const REJECTED_ARTICLE_DAYS = 90

/**
 * Nightly housekeeping. Replaces 1.0's dedup-cleanup, which only purged hashes.
 * Stored context packs are the big one — each is ~25K tokens of JSON, useful
 * for auditing a recent brief and dead weight after a month.
 */
export async function GET(request: NextRequest) {
  if (request.headers.get('Authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const [hashes, packs, articles] = await Promise.all([
      purgeOlderThan(DEDUP_HOURS),
      purgeContextPacksOlderThan(CONTEXT_PACK_DAYS),
      purgeRejectedOlderThan(REJECTED_ARTICLE_DAYS),
    ])

    console.log(
      `[cleanup] ${hashes} hashes, ${packs} context packs, ${articles} rejected articles`
    )
    return NextResponse.json({ ok: true, hashes, context_packs: packs, articles })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[cleanup] fatal:', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
