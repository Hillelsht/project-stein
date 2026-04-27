import Parser from 'rss-parser'
import { getActiveSources, updateLastPolled } from '@/lib/repositories/sourceRepo'
import { saveArticle } from '@/lib/repositories/articleRepo'
import type { Source } from '@/lib/repositories/sourceRepo'

type IngestResult = {
  fetched: number
  saved: number
  errors: string[]
}

export type IngestSummary = {
  total: IngestResult
  perSource: Record<string, IngestResult>
}

// Extracts "Item 1.01", "Items 1.01, 2.02" etc. from SEC filing text.
// Prepended to raw_content as "[SEC_ITEMS:1.01,2.02]" so filterService
// can check item codes without re-parsing.
function extractSecItems(text: string): string[] {
  const found: string[] = []
  const re = /\bitems?\s+([\d]+\.[\d]+)/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    found.push(match[1])
  }
  return [...new Set(found)]
}

function buildRawContent(
  item: Parser.Item,
  isSecSource: boolean
): string {
  const parts = [item.content, item.contentSnippet, item['summary']]
    .filter((p): p is string => typeof p === 'string' && p.length > 0)
    .join('\n\n')
    .slice(0, 10000)

  if (isSecSource) {
    const combined = `${item.title ?? ''} ${parts}`
    const codes = extractSecItems(combined)
    if (codes.length > 0) {
      return `[SEC_ITEMS:${codes.join(',')}]\n${parts}`
    }
  }

  return parts
}

async function fetchSource(source: Source): Promise<IngestResult> {
  const isSecSource = source.rss_url.includes('sec.gov')
  const result: IngestResult = { fetched: 0, saved: 0, errors: [] }

  const parser = new Parser<Record<string, string>, { summary?: string }>({
    headers: isSecSource
      ? { 'User-Agent': process.env.SEC_USER_AGENT ?? 'ProjectStein/1.0' }
      : {},
    timeout: 15000,
    customFields: { item: ['summary'] },
  })

  let feed: Awaited<ReturnType<typeof parser.parseURL>>
  try {
    feed = await parser.parseURL(source.rss_url)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    result.errors.push(`${source.name}: fetch failed — ${msg}`)
    return result
  }

  for (const item of feed.items) {
    result.fetched++

    const url = item.link?.trim()
    const title = item.title?.trim()
    if (!url || !title) continue

    const rawContent = buildRawContent(item, isSecSource)
    const publishedAt = item.isoDate ?? item.pubDate ?? null

    try {
      const saved = await saveArticle({
        source_id: source.id,
        title,
        url,
        published_at: publishedAt,
        raw_content: rawContent || null,
      })
      if (saved !== null) result.saved++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      result.errors.push(`${source.name}: save failed for "${title}" — ${msg}`)
    }
  }

  return result
}

export async function fetchAndStoreAll(): Promise<IngestSummary> {
  const sources = await getActiveSources()
  const perSource: Record<string, IngestResult> = {}
  const total: IngestResult = { fetched: 0, saved: 0, errors: [] }

  for (const source of sources) {
    const result = await fetchSource(source)
    perSource[source.name] = result
    total.fetched += result.fetched
    total.saved += result.saved
    total.errors.push(...result.errors)

    try {
      await updateLastPolled(source.id)
    } catch {
      // Non-fatal — just means last_polled_at won't update this run
    }
  }

  return { total, perSource }
}
