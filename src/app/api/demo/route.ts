import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { clearDemoData, seedDemoData } from '@/lib/services/demoService'

/**
 * Seed or clear demo data so the UI can be judged before real credentials
 * exist. Session- or CRON_SECRET-authenticated.
 *
 *   POST /api/demo            → seed
 *   DELETE /api/demo          → remove every demo row
 */
async function authorize(request: NextRequest): Promise<boolean> {
  if (request.headers.get('Authorization') === `Bearer ${process.env.CRON_SECRET}`) return true
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  return Boolean(user)
}

export async function POST(request: NextRequest) {
  if (!(await authorize(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    return NextResponse.json(await seedDemoData())
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  if (!(await authorize(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    return NextResponse.json(await clearDemoData())
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
