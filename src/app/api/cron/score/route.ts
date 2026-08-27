import { NextRequest, NextResponse } from 'next/server'
import { scoreOpenRecommendations } from '@/lib/services/scoringService'

// Paced Yahoo calls, one per distinct open ticker plus the benchmark.
export const maxDuration = 60

export async function GET(request: NextRequest) {
  if (request.headers.get('Authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const summary = await scoreOpenRecommendations()
    return NextResponse.json(summary)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[score] fatal:', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
