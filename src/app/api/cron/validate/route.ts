import { NextRequest, NextResponse } from 'next/server'
import { fillOutcomesForRecentSignals } from '@/lib/services/validationService'

export async function GET(request: NextRequest) {
  if (request.headers.get('Authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await fillOutcomesForRecentSignals()
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const message =
      err instanceof Error ? err.message :
      typeof err === 'object' && err !== null ? JSON.stringify(err) :
      String(err)
    console.error('[validate] fatal:', message, err)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
