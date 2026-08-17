import { NextRequest, NextResponse } from 'next/server'
import { buildContextPack, toCompactPack } from '@/lib/services/contextPackService'
import type { BriefType } from '@/lib/repositories/briefRepo'

// Assembling the pack makes many paced market-data calls; generation adds a
// large LLM round trip on top.
export const maxDuration = 300

/**
 * Which scheduled brief a bare cron hit refers to. The pre-market job fires at
 * 11:00 UTC and the evening job at 21:30 UTC, so anything before ~16:00 UTC is
 * the morning slot.
 */
function inferBriefType(now = new Date()): BriefType {
  return now.getUTCHours() < 16 ? 'PREMARKET' : 'EVENING'
}

function parseBriefType(raw: string | null): BriefType | null {
  if (!raw) return null
  const v = raw.toUpperCase()
  if (v === 'PREMARKET' || v === 'EVENING' || v === 'ON_DEMAND') return v
  return null
}

export async function GET(request: NextRequest) {
  if (request.headers.get('Authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const params = request.nextUrl.searchParams
  const briefType = parseBriefType(params.get('type')) ?? inferBriefType()

  try {
    const pack = await buildContextPack(briefType)

    // Phase 17 ships the pack only — generation lands in Phase 18. Until then
    // every call behaves as a dry run so the pack can be inspected first.
    if (params.get('compact') === '1') {
      const compact = toCompactPack(pack)
      return NextResponse.json({ ok: true, dry_run: true, pack: compact })
    }

    return NextResponse.json({ ok: true, dry_run: true, pack })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[brief] fatal:', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
