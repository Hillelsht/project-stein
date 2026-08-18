import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { runPreflight } from '@/lib/services/preflightService'

// The deep check runs a real IBKR statement request.
export const maxDuration = 60

/**
 * Setup verification. Authenticated by session OR CRON_SECRET, so it works both
 * from the browser and from a terminal during setup — including before the
 * Supabase user exists.
 */
export async function GET(request: NextRequest) {
  const bearer = request.headers.get('Authorization')
  const hasSecret = bearer === `Bearer ${process.env.CRON_SECRET}`

  if (!hasSecret) {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const deep = request.nextUrl.searchParams.get('deep') === '1'
  const result = await runPreflight(deep)
  return NextResponse.json(result, { status: result.ready ? 200 : 503 })
}
