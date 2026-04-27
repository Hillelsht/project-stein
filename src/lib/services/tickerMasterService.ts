import { bulkUpsertTickers } from '@/lib/repositories/tickerMasterRepo'
import type { TickerRow } from '@/lib/repositories/tickerMasterRepo'

type NewTickerRow = Omit<TickerRow, 'created_at'>

const NASDAQ_LISTED_URL = 'https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt'
const OTHER_LISTED_URL  = 'https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt'

// Only accept clean alphabetic symbols that our ticker regex can match.
// Rejects warrants ($), preferred shares (+), units (=), test issues, etc.
const VALID_SYMBOL = /^[A-Z]{1,5}$/

async function fetchFile(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'ProjectStein/1.0' },
    // No cache — we always want the live file
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`)
  return res.text()
}

// nasdaqlisted.txt columns:
// 0:Symbol | 1:Security Name | 2:Market Category | 3:Test Issue | 4:Financial Status | 5:Round Lot Size | 6:ETF | 7:NextShares
function parseNasdaqListed(text: string, refreshedAt: string): NewTickerRow[] {
  const rows: NewTickerRow[] = []
  const lines = text.split('\n')

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line || line.startsWith('File Creation')) continue

    const cols = line.split('|')
    if (cols.length < 4) continue

    const symbol    = cols[0].trim()
    const testIssue = cols[3].trim()

    if (testIssue === 'Y') continue
    if (!VALID_SYMBOL.test(symbol)) continue

    rows.push({
      ticker_symbol:     symbol,
      company_name:      cols[1].trim() || null,
      exchange:          'NASDAQ',
      active:            true,
      last_refreshed_at: refreshedAt,
    })
  }

  return rows
}

// otherlisted.txt columns:
// 0:ACT Symbol | 1:Security Name | 2:Exchange | 3:CQS Symbol | 4:ETF | 5:Round Lot Size | 6:Test Issue | 7:NASDAQ Symbol
function parseOtherListed(text: string, refreshedAt: string): NewTickerRow[] {
  const rows: NewTickerRow[] = []
  const lines = text.split('\n')

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line || line.startsWith('File Creation')) continue

    const cols = line.split('|')
    if (cols.length < 7) continue

    const symbol    = cols[0].trim()
    const testIssue = cols[6].trim()

    if (testIssue === 'Y') continue
    if (!VALID_SYMBOL.test(symbol)) continue

    rows.push({
      ticker_symbol:     symbol,
      company_name:      cols[1].trim() || null,
      exchange:          'NYSE',
      active:            true,
      last_refreshed_at: refreshedAt,
    })
  }

  return rows
}

export type RefreshResult = {
  nasdaq: number
  other: number
  total: number
  upserted: number
}

export async function refreshTickerMaster(): Promise<RefreshResult> {
  const refreshedAt = new Date().toISOString()

  const [nasdaqText, otherText] = await Promise.all([
    fetchFile(NASDAQ_LISTED_URL),
    fetchFile(OTHER_LISTED_URL),
  ])

  const nasdaqRows = parseNasdaqListed(nasdaqText, refreshedAt)
  const otherRows  = parseOtherListed(otherText, refreshedAt)

  // Merge; NASDAQ rows take precedence if a symbol appears in both files
  const bySymbol = new Map<string, NewTickerRow>()
  for (const row of otherRows)  bySymbol.set(row.ticker_symbol, row)
  for (const row of nasdaqRows) bySymbol.set(row.ticker_symbol, row)

  const merged = Array.from(bySymbol.values())
  await bulkUpsertTickers(merged)

  return {
    nasdaq:   nasdaqRows.length,
    other:    otherRows.length,
    total:    merged.length,
    upserted: merged.length,
  }
}
