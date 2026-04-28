import { NextRequest, NextResponse } from 'next/server'
import { purgeOlderThan } from '@/lib/repositories/dedupRepo'

export async function GET(request: NextRequest) {
  if (request.headers.get('Authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const deleted = await purgeOlderThan(48)
    console.log(`[dedup-cleanup] purged ${deleted} hashes older than 48h`)
    return NextResponse.json({ ok: true, deleted })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[dedup-cleanup] fatal:', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
