import { NextRequest, NextResponse } from 'next/server'
import { fetchAndStoreAll } from '@/lib/services/rssService'

export async function GET(request: NextRequest) {
  if (request.headers.get('Authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const summary = await fetchAndStoreAll()
    console.log('[ingest]', JSON.stringify(summary.total))
    return NextResponse.json({ ok: true, ...summary })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[ingest] fatal:', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
