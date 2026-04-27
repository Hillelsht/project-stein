import { NextRequest, NextResponse } from 'next/server'
import { getUnanalyzedArticles, markFilterPass, markFilterReject } from '@/lib/repositories/articleRepo'
import { runFilterPipeline } from '@/lib/services/filterService'

// Phase 6 will extend this route to call llmService on passed articles.
export async function GET(request: NextRequest) {
  if (request.headers.get('Authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const articles = await getUnanalyzedArticles(200)
    let passed = 0
    let rejected = 0
    const reasons: Record<string, number> = {}

    for (const article of articles) {
      const result = await runFilterPipeline(article)

      if (result.pass) {
        await markFilterPass(article.id)
        passed++
      } else {
        const reason = result.reason ?? 'unknown'
        await markFilterReject(article.id, reason)
        rejected++
        reasons[reason] = (reasons[reason] ?? 0) + 1
      }
    }

    console.log('[analyze]', { passed, rejected, reasons })
    return NextResponse.json({ ok: true, passed, rejected, reasons })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[analyze] fatal:', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
