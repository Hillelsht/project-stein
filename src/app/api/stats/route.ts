import { NextRequest, NextResponse } from 'next/server'
import { computeStats } from '@/lib/services/validationService'

export async function GET(request: NextRequest) {
  if (request.headers.get('Authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const days = Number(new URL(request.url).searchParams.get('days') ?? '30')
    const buckets = await computeStats(isFinite(days) && days > 0 ? days : 30)
    return NextResponse.json({ ok: true, days, buckets })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[stats] fatal:', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
