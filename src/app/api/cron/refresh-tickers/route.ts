import { NextRequest, NextResponse } from 'next/server'
import { refreshTickerMaster } from '@/lib/services/tickerMasterService'

export async function GET(request: NextRequest) {
  if (request.headers.get('Authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await refreshTickerMaster()
    console.log('[refresh-tickers]', JSON.stringify(result))
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[refresh-tickers] fatal:', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
