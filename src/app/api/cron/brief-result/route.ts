import { NextRequest, NextResponse } from 'next/server'
import { getBriefById, updateBrief } from '@/lib/repositories/briefRepo'
import { completeBriefFromRawOutput, type RawBrief } from '@/lib/services/briefService'
import { parseJson } from '@/lib/services/llmClient'

export const maxDuration = 120

/**
 * Receives the Claude worker's output and runs it through exactly the same
 * validation, ledger, and delivery path as an in-app generation. The worker is
 * a transport, not a second implementation.
 */
export async function POST(request: NextRequest) {
  if (request.headers.get('Authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { brief_id?: string; model?: string; output?: string; error?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const briefId = body.brief_id
  if (!briefId) return NextResponse.json({ error: 'brief_id required' }, { status: 400 })

  const brief = await getBriefById(briefId)
  if (!brief) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // The worker reports its own failures so the brief doesn't sit PENDING until
  // the stale-pending sweep notices.
  if (body.error) {
    await updateBrief(briefId, { status: 'FAILED', error: body.error.slice(0, 500) })
    return NextResponse.json({ ok: false, status: 'FAILED' })
  }

  const raw = parseJson<RawBrief>(body.output ?? '')
  if (!raw) {
    const message = 'Worker output was not valid JSON'
    await updateBrief(briefId, { status: 'FAILED', error: message })
    return NextResponse.json({ ok: false, error: message }, { status: 422 })
  }

  try {
    const result = await completeBriefFromRawOutput(briefId, raw, {
      model: body.model ?? brief.requested_model ?? 'claude',
    })
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await updateBrief(briefId, { status: 'FAILED', error: message.slice(0, 500) })
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
