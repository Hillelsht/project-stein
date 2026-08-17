import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getBriefById } from '@/lib/repositories/briefRepo'

/**
 * Lightweight status poll for the Run Now panel while an Actions-runner brief
 * is being generated. Session-authenticated (the proxy excludes /api).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const brief = await getBriefById(id)
  if (!brief) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({
    status: brief.status,
    model: brief.model,
    error: brief.error,
    generated_at: brief.generated_at,
  })
}
