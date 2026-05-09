import { NextResponse } from 'next/server'
import { getPipelineHealth } from '@/lib/services/opsService'

// Public — pingable by external uptime monitors. Exposes only counts/timestamps,
// nothing sensitive. HTTP status mirrors pipeline health so monitors can alert
// on a non-200 without parsing JSON.
export async function GET() {
  try {
    const health = await getPipelineHealth()
    const httpStatus = health.status === 'ok' ? 200 : 503
    return NextResponse.json(health, { status: httpStatus })
  } catch (err) {
    const message =
      err instanceof Error ? err.message :
      typeof err === 'object' && err !== null ? JSON.stringify(err) :
      String(err)
    console.error('[health] fatal:', message, err)
    return NextResponse.json(
      { status: 'unknown', error: message },
      { status: 503 },
    )
  }
}
