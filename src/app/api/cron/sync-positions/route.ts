import { NextRequest, NextResponse } from 'next/server'
import { syncPositions } from '@/lib/services/flexService'

// Flex statement generation is asynchronous; polling can take ~45s.
export const maxDuration = 60

export async function GET(request: NextRequest) {
  if (request.headers.get('Authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await syncPositions()
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[sync-positions] fatal:', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
