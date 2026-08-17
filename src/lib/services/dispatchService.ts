import { createBrief, getBrief, updateBrief } from '@/lib/repositories/briefRepo'
import { buildContextPack } from '@/lib/services/contextPackService'
import { toDateKey } from '@/lib/marketCalendar'
import type { BriefType } from '@/lib/repositories/briefRepo'
import type { ModelEntry } from '@/lib/services/modelRegistry'

/**
 * Dispatching an `actions`-runner brief.
 *
 * Claude runs on the owner's Pro/Max subscription, which is not an API key and
 * therefore cannot be called from a serverless function. Instead a GitHub
 * Actions job runs Claude Code headlessly, pulls the context pack from this app,
 * and posts the finished brief back. Vercel's part is: build the pack, park a
 * PENDING row, and fire the workflow.
 */

const WORKFLOW_FILE = 'brief-worker.yml'

function repoSlug(): string {
  const slug = process.env.GITHUB_REPO
  if (!slug || !slug.includes('/')) {
    throw new Error('GITHUB_REPO must be set to "owner/repo" to dispatch the brief worker')
  }
  return slug
}

export async function dispatchBriefWorker(
  model: ModelEntry,
  briefType: BriefType = 'ON_DEMAND'
): Promise<{ briefId: string }> {
  const token = process.env.GITHUB_DISPATCH_TOKEN
  if (!token) {
    throw new Error('GITHUB_DISPATCH_TOKEN not set — cannot run subscription-backed models')
  }

  // Build the pack here rather than in the worker: the worker has no database
  // credentials, and storing it now means the result route can validate the
  // model's output against exactly the input it was given.
  const pack = await buildContextPack(briefType)
  const briefDate = toDateKey(new Date())

  const existing = briefType === 'ON_DEMAND' ? null : await getBrief(briefDate, briefType)
  const brief =
    existing ??
    (await createBrief({
      brief_date: briefDate,
      brief_type: briefType,
      status: 'PENDING',
      requested_model: model.id,
    }))

  await updateBrief(brief.id, {
    status: 'PENDING',
    requested_model: model.id,
    context_pack: pack as unknown as Record<string, unknown>,
    error: null,
    attempt_count: (existing?.attempt_count ?? 0) + 1,
  })

  const res = await fetch(
    `https://api.github.com/repos/${repoSlug()}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ref: process.env.GITHUB_REF_NAME || 'master',
        inputs: { brief_id: brief.id, model: model.wireName },
      }),
    }
  )

  if (!res.ok) {
    const body = await res.text()
    const message = `GitHub dispatch ${res.status}: ${body.slice(0, 200)}`
    await updateBrief(brief.id, { status: 'FAILED', error: message })
    throw new Error(message)
  }

  console.log(`[dispatch] brief ${brief.id.slice(0, 8)} → ${model.wireName} worker`)
  return { briefId: brief.id }
}
