import { NextRequest, NextResponse } from 'next/server'
import {
  getUnanalyzedArticles,
  markFilterPass,
  markFilterReject,
} from '@/lib/repositories/articleRepo'
import { runFilterPipeline } from '@/lib/services/filterService'

// Bounded work: no LLM calls, just regex and two small queries per article.
export const maxDuration = 60

const BATCH_SIZE = 200

/**
 * Marks which freshly-ingested articles are material enough to reach the brief.
 *
 * This replaces Stein 1.0's `/api/cron/analyze`, which ran the same filter and
 * then made an LLM call per surviving article — up to 800 a day. The filter
 * survives as the *selector* for the brief's news section; nothing here talks
 * to a model.
 */
export async function GET(request: NextRequest) {
  if (request.headers.get('Authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const articles = await getUnanalyzedArticles(BATCH_SIZE)
    let passed = 0
    let rejected = 0
    const reasons: Record<string, number> = {}

    for (const article of articles) {
      try {
        const result = await runFilterPipeline(article)
        if (result.pass) {
          await markFilterPass(article.id)
          passed++
        } else {
          await markFilterReject(article.id, result.reason ?? 'unknown')
          rejected++
          const reason = result.reason ?? 'unknown'
          reasons[reason] = (reasons[reason] ?? 0) + 1
        }
      } catch (err) {
        // One bad article must never abort the batch.
        console.warn(`[select] article ${article.id.slice(0, 8)} failed:`, (err as Error).message)
      }
    }

    console.log(`[select] ${passed} passed, ${rejected} rejected of ${articles.length}`)
    return NextResponse.json({ ok: true, considered: articles.length, passed, rejected, reasons })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[select] fatal:', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
