import { NextRequest, NextResponse } from 'next/server'
import { getBriefById } from '@/lib/repositories/briefRepo'
import { buildBriefPrompt } from '@/lib/prompts/briefPrompt'
import type { ContextPack } from '@/lib/services/contextPackService'

/**
 * Hands the GitHub Actions worker everything it needs to write a brief.
 *
 * The worker has no database access — it receives a finished prompt, runs it
 * through Claude on the owner's subscription, and posts the raw output back to
 * /api/cron/brief-result.
 */
export async function GET(request: NextRequest) {
  if (request.headers.get('Authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const briefId = request.nextUrl.searchParams.get('brief_id')
  if (!briefId) {
    return NextResponse.json({ error: 'brief_id required' }, { status: 400 })
  }

  const brief = await getBriefById(briefId)
  if (!brief) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!brief.context_pack) {
    return NextResponse.json({ error: 'Brief has no context pack' }, { status: 409 })
  }

  const pack = brief.context_pack as unknown as ContextPack

  return NextResponse.json({
    brief_id: brief.id,
    brief_type: brief.brief_type,
    brief_date: brief.brief_date,
    prompt: buildBriefPrompt(pack),
  })
}
