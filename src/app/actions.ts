'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import { setSetting } from '@/lib/repositories/settingsRepo'
import { generateBrief } from '@/lib/services/briefService'
import { getModelOrDefault } from '@/lib/services/modelRegistry'
import { dispatchBriefWorker } from '@/lib/services/dispatchService'

/** Shared app-level server actions. */

export async function signOutAction(): Promise<void> {
  const supabase = await createServerClient()
  await supabase.auth.signOut()
  redirect('/login')
}

export type RunBriefState = {
  ok: boolean
  message: string
  briefId?: string
  pending?: boolean
}

/**
 * The Run Now button.
 *
 * A `vercel`-runner model generates inline and the page refreshes with the
 * finished brief. An `actions`-runner model (Claude on the owner's
 * subscription) can't run inside a serverless request, so it creates a PENDING
 * brief, dispatches the GitHub Actions worker, and the panel polls until it
 * flips to GENERATED.
 */
export async function runBriefNowAction(modelId: string): Promise<RunBriefState> {
  const model = getModelOrDefault(modelId)

  try {
    if (model.runner === 'actions') {
      const { briefId } = await dispatchBriefWorker(model)
      revalidatePath('/')
      return {
        ok: true,
        pending: true,
        briefId,
        message: `${model.label} is running in GitHub Actions — usually 2–3 minutes.`,
      }
    }

    const result = await generateBrief({ briefType: 'ON_DEMAND', modelId: model.id })
    revalidatePath('/')

    if (!result.ok) {
      return { ok: false, message: result.error ?? 'Generation failed.' }
    }
    return {
      ok: true,
      briefId: result.brief_id,
      message: `Brief ready — ${result.opened ?? 0} new idea(s).`,
    }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

export async function setDefaultModelAction(modelId: string): Promise<void> {
  const model = getModelOrDefault(modelId)
  await setSetting('default_brief_model', model.id)
  revalidatePath('/')
}
