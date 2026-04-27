import { createHash } from 'crypto'
import { BLOCKLIST, validateTickerBatch } from '@/lib/repositories/tickerMasterRepo'
import { hashExists, saveHash } from '@/lib/repositories/dedupRepo'
import { getAllWatchlistTickers } from '@/lib/repositories/watchlistRepo'
import { countAnalysesToday } from '@/lib/repositories/analysisRepo'
import type { Article } from '@/lib/repositories/articleRepo'

// ── Stage 1: Ticker extraction ──────────────────────────────────────────────

// Matches 1–5 uppercase letters, optionally preceded by $, not part of a
// longer uppercase run (to avoid matching words like "ANNOUNCED").
const TICKER_RE = /(?:^|[^A-Z])\$?([A-Z]{1,5})(?=[^A-Z]|$)/g

export async function extractTickers(text: string): Promise<string[]> {
  const candidates = new Set<string>()
  const re = new RegExp(TICKER_RE.source, 'g')
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const sym = match[1]
    if (sym && !BLOCKLIST.has(sym)) candidates.add(sym)
  }
  if (candidates.size === 0) return []
  return validateTickerBatch([...candidates])
}

// ── Stage 2: Material keyword filter ────────────────────────────────────────

const KEYWORD_PATTERNS = [
  // M&A
  'acqui(?:re|red|res|ring|sitions?)', 'merger', 'buyout', 'tender\\s+offer',
  'takeover', 'divests?', 'spin-?off',
  // Earnings
  'earnings?', 'revenue', '\\bEPS\\b', 'guidance', 'forecast', 'outlook',
  '\\bbeat\\b', '\\bmisses?\\b', '\\braised?\\b', '\\blowered?\\b',
  '\\bwarning\\b', 'preannounce',
  // Regulatory
  '\\bFDA\\b', 'approval', '\\brecall\\b', 'warning\\s+letter',
  '510\\s*\\(k\\)', 'clearance', 'phase\\s+[123]', '\\bPDUFA\\b',
  'breakthrough\\s+designation',
  // Legal
  'lawsuit', 'settlement', 'injunction', 'SEC\\s+charges', '\\bfraud\\b',
  'investigation', 'subpoena', 'class\\s+action', 'antitrust',
  // Leadership
  '\\bCEO\\b', '\\bCFO\\b', '\\bresigns?\\b', '\\bfired\\b',
  '\\bappointed\\b', 'steps?\\s+down', 'succession', '\\bterminated\\b',
  // Capital
  'buyback', 'dividend', 'stock\\s+split', '\\boffering\\b', '\\bissuance\\b',
  'bankruptcy', 'chapter\\s+11', '\\bdefault\\b', 'restructuring',
  '\\b13[DG]\\b', 'activist',
  // Operations
  'contract\\s+awarded', 'partnership', 'joint\\s+venture',
  'license\\s+agreement', 'patent\\s+(?:granted|infringement)',
]

const MATERIAL_KEYWORD_RE = new RegExp(KEYWORD_PATTERNS.join('|'), 'i')

export function hasMaterialKeyword(text: string): boolean {
  return MATERIAL_KEYWORD_RE.test(text)
}

// ── Stage 3: SEC 8-K item filter ────────────────────────────────────────────

const MATERIAL_SEC_ITEMS = new Set([
  '1.01', '1.02', '1.03', '2.01', '2.02',
  '3.01', '4.02', '5.02', '7.01', '8.01',
])

export function parseSecItems(rawContent: string): string[] {
  const match = rawContent.match(/^\[SEC_ITEMS:([^\]]+)\]/)
  if (!match) return []
  return match[1].split(',').map((s) => s.trim()).filter(Boolean)
}

export function hasMaterialSecItem(items: string[]): boolean {
  return items.some((item) => MATERIAL_SEC_ITEMS.has(item))
}

// ── Stage 4: Deduplication ───────────────────────────────────────────────────

export function computeDedupHash(title: string, body: string): string {
  const normalized = title.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
  const input = normalized + '|' + body.slice(0, 200)
  return createHash('sha256').update(input).digest('hex')
}

// ── Pipeline orchestrator ────────────────────────────────────────────────────

export type FilterResult = {
  pass: boolean
  reason?: string
  tickers: string[]
}

export async function runFilterPipeline(article: Article): Promise<FilterResult> {
  const text = `${article.title} ${article.raw_content ?? ''}`

  // Stage 1: Extract and validate tickers
  const tickers = await extractTickers(text)

  // Stage 2: Material keyword — required regardless of ticker presence
  if (!hasMaterialKeyword(text)) {
    return { pass: false, reason: 'no_material_keyword', tickers }
  }

  // Stage 3: SEC item filter — only applies to SEC articles (identified by prefix)
  const rawContent = article.raw_content ?? ''
  if (rawContent.startsWith('[SEC_ITEMS:')) {
    const items = parseSecItems(rawContent)
    if (!hasMaterialSecItem(items)) {
      return { pass: false, reason: 'immaterial_sec_item', tickers }
    }
  }

  // Stage 4: Dedup — check 48hr hash window; save hash on pass
  const hash = computeDedupHash(article.title, rawContent)
  if (await hashExists(hash)) {
    return { pass: false, reason: 'duplicate', tickers }
  }
  await saveHash(hash, article.id)

  // Stage 5 + 6: Watchlist priority determines whether budget check applies
  const watchlistTickers = await getAllWatchlistTickers()
  const watchlistSet = new Set(watchlistTickers)
  const isWatchlistMatch = tickers.some((t) => watchlistSet.has(t))

  if (!isWatchlistMatch) {
    const todayCount = await countAnalysesToday()
    if (todayCount >= 800) {
      return { pass: false, reason: 'daily_budget', tickers }
    }
  }

  return { pass: true, tickers }
}
