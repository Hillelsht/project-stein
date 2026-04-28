import { NextRequest, NextResponse } from 'next/server'
import { getUnanalyzedArticles, markFilterPass, markFilterReject } from '@/lib/repositories/articleRepo'
import { runFilterPipeline } from '@/lib/services/filterService'
import { analyzeArticle } from '@/lib/services/llmService'

export async function GET(request: NextRequest) {
  if (request.headers.get('Authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const articles = await getUnanalyzedArticles(200)
    let passed = 0
    let rejected = 0
    let analyzed = 0
    const reasons: Record<string, number> = {}

    for (const article of articles) {
      const result = await runFilterPipeline(article)

      if (!result.pass) {
        const reason = result.reason ?? 'unknown'
        await markFilterReject(article.id, reason)
        rejected++
        reasons[reason] = (reasons[reason] ?? 0) + 1
        continue
      }

      await markFilterPass(article.id)
      passed++

      await analyzeArticle(article)
      analyzed++
    }

    console.log('[analyze]', { passed, rejected, analyzed, reasons })
    return NextResponse.json({ ok: true, passed, rejected, analyzed, reasons })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[analyze] fatal:', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
