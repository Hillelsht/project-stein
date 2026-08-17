import { getFilteredArticlesSince } from '@/lib/repositories/articleRepo'
import { getPositions } from '@/lib/repositories/positionRepo'
import { getOpenRecommendations } from '@/lib/repositories/recommendationRepo'
import { getAllWatchlistTickers } from '@/lib/repositories/watchlistRepo'
import {
  getEarningsDates,
  getMacroSnapshot,
  getTechnicalsBatch,
  type MacroQuote,
  type Technicals,
} from '@/lib/services/marketDataService'
import { previousTradingDay, toDateKey } from '@/lib/marketCalendar'
import type { BriefType } from '@/lib/repositories/briefRepo'

/**
 * The context pack is everything the model is allowed to reason from.
 *
 * Stein 1.0 sent a truncated article to a small model and asked for a score.
 * 2.0 inverts that: all the facts are gathered here — real positions, computed
 * technicals, the calendar, and the model's own open calls with live P&L — so
 * the LLM does synthesis rather than arithmetic or recall.
 */

const NEWS_HOURS_BACK = 24
const NEWS_CANDIDATE_LIMIT = 400
const NEWS_CAP = 60
const NEWS_CAP_COMPACT = 15
const SNIPPET_CHARS = 240
const THESIS_CHARS = 300
const EARNINGS_HORIZON_DAYS = 14

export type PackNews = {
  title: string
  source: string | null
  published_at: string | null
  tickers: string[]
  snippet: string
}

export type PackPosition = {
  ticker: string
  quantity: number
  avg_cost: number | null
  market_value: number | null
  unrealized_pnl: number | null
  unrealized_pnl_pct: number | null
  next_earnings: string | null
  technicals: Technicals | null
}

export type PackWatchlistItem = {
  ticker: string
  next_earnings: string | null
  technicals: Technicals | null
}

export type PackOpenRec = {
  id: string
  ticker: string
  direction: 'LONG' | 'SHORT'
  opened_on: string
  entry_price: number | null
  current_price: number | null
  return_pct: number | null
  invalidation_price: number
  distance_to_invalidation_pct: number | null
  horizon_date: string
  trading_days_left: number
  conviction: number
  thesis: string
}

export type ContextPack = {
  generated_at: string
  brief_type: BriefType
  trading_date: string
  macro: MacroQuote[]
  positions: PackPosition[]
  watchlist: PackWatchlistItem[]
  open_recommendations: PackOpenRec[]
  news: PackNews[]
  earnings_calendar: { ticker: string; date: string }[]
  counts: {
    positions: number
    watchlist: number
    open_recommendations: number
    news_considered: number
    news_included: number
  }
  approx_tokens: number
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Rough token estimate; 4 chars/token is close enough to police a size budget. */
export function approxTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / 4)
}

function tidySnippet(raw: string | null): string {
  if (!raw) return ''
  return raw
    .replace(/^\[SEC_ITEMS:[^\]]*\]\s*/, '') // ingest prefix, not model-facing
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SNIPPET_CHARS)
}

/** Cheap ticker spotting used only to prioritise news, not to create signals. */
function tickersMentioned(text: string, universe: Set<string>): string[] {
  const found: string[] = []
  for (const candidate of text.toUpperCase().match(/\b[A-Z]{1,5}\b/g) ?? []) {
    if (universe.has(candidate) && !found.includes(candidate)) found.push(candidate)
  }
  return found
}

function tradingDaysBetween(from: Date, to: Date): number {
  let count = 0
  const d = new Date(from)
  d.setUTCHours(0, 0, 0, 0)
  const end = new Date(to)
  end.setUTCHours(0, 0, 0, 0)
  while (d < end) {
    d.setUTCDate(d.getUTCDate() + 1)
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) count++
  }
  return count
}

// ── Assembly ─────────────────────────────────────────────────────────────────

export async function buildContextPack(briefType: BriefType): Promise<ContextPack> {
  const [positions, watchlistTickers, openRecs] = await Promise.all([
    getPositions(),
    getAllWatchlistTickers(),
    getOpenRecommendations(),
  ])

  const positionTickers = positions.map((p) => p.ticker_symbol)
  const recTickers = openRecs.map((r) => r.ticker_symbol)

  // Watchlist entries already held are covered by the positions section.
  const watchOnly = watchlistTickers.filter((t) => !positionTickers.includes(t))

  const allTickers = [...new Set([...positionTickers, ...watchOnly, ...recTickers])]

  // Market data: one sequential paced pass over everything we care about.
  const [macro, technicals, earnings] = await Promise.all([
    getMacroSnapshot(),
    getTechnicalsBatch(allTickers),
    getEarningsDates(allTickers),
  ])

  const earningsByTicker = new Map(earnings.map((e) => [e.ticker, e.date]))

  const packPositions: PackPosition[] = positions.map((p) => {
    const costBasis = p.avg_cost !== null ? p.avg_cost * p.quantity : null
    return {
      ticker: p.ticker_symbol,
      quantity: p.quantity,
      avg_cost: p.avg_cost,
      market_value: p.market_value,
      unrealized_pnl: p.unrealized_pnl,
      unrealized_pnl_pct:
        p.unrealized_pnl !== null && costBasis !== null && costBasis !== 0
          ? Math.round((p.unrealized_pnl / Math.abs(costBasis)) * 10000) / 100
          : null,
      next_earnings: earningsByTicker.get(p.ticker_symbol) ?? null,
      technicals: technicals.get(p.ticker_symbol) ?? null,
    }
  })

  const packWatchlist: PackWatchlistItem[] = watchOnly.map((t) => ({
    ticker: t,
    next_earnings: earningsByTicker.get(t) ?? null,
    technicals: technicals.get(t) ?? null,
  }))

  const now = new Date()

  // Open recommendations are included with live P&L and distance to their stop
  // so the model has to confront its own past calls rather than only proposing
  // new ones. This is what makes the ledger self-correcting.
  const packOpenRecs: PackOpenRec[] = openRecs.map((r) => {
    const current = technicals.get(r.ticker_symbol)?.last_close ?? r.current_price
    const entry = r.entry_price
    const sign = r.direction === 'SHORT' ? -1 : 1
    return {
      id: r.id,
      ticker: r.ticker_symbol,
      direction: r.direction,
      opened_on: r.created_at.slice(0, 10),
      entry_price: entry,
      current_price: current ?? null,
      return_pct:
        entry !== null && entry !== 0 && current != null
          ? Math.round(((current - entry) / entry) * sign * 10000) / 100
          : null,
      invalidation_price: r.invalidation_price,
      distance_to_invalidation_pct:
        current != null && current !== 0
          ? Math.round(((current - r.invalidation_price) / current) * sign * 10000) / 100
          : null,
      horizon_date: r.horizon_date,
      trading_days_left: tradingDaysBetween(now, new Date(`${r.horizon_date}T00:00:00Z`)),
      conviction: r.conviction,
      thesis: r.thesis.slice(0, THESIS_CHARS),
    }
  })

  // ── News selection ────────────────────────────────────────────────────────
  // The 1.0 regex pre-filter survives as the *selector*: it decides which
  // articles are material enough to reach the model. What it no longer does is
  // trigger an LLM call per article.
  const articles = await getFilteredArticlesSince(NEWS_HOURS_BACK, NEWS_CANDIDATE_LIMIT)

  const positionSet = new Set(positionTickers)
  const watchSet = new Set([...watchOnly, ...recTickers])
  const universe = new Set([...positionTickers, ...watchOnly, ...recTickers])

  const scored = articles.map((a) => {
    const text = `${a.title} ${a.raw_content ?? ''}`
    const mentioned = tickersMentioned(text, universe)
    const holdsOne = mentioned.some((t) => positionSet.has(t))
    const watchesOne = mentioned.some((t) => watchSet.has(t))
    // 3 = touches a holding, 2 = touches a watch/open-rec name, 1 = general market
    const priority = holdsOne ? 3 : watchesOne ? 2 : 1
    return { article: a, mentioned, priority }
  })

  scored.sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority
    const at = new Date(a.article.fetched_at).getTime()
    const bt = new Date(b.article.fetched_at).getTime()
    return bt - at
  })

  const news: PackNews[] = scored.slice(0, NEWS_CAP).map(({ article, mentioned }) => ({
    title: article.title,
    source: article.sources?.name ?? null,
    published_at: article.published_at ?? article.fetched_at,
    tickers: mentioned,
    snippet: tidySnippet(article.raw_content),
  }))

  // ── Earnings calendar ─────────────────────────────────────────────────────
  const horizonEnd = new Date(now)
  horizonEnd.setUTCDate(horizonEnd.getUTCDate() + EARNINGS_HORIZON_DAYS)
  const earningsCalendar = earnings
    .filter((e) => {
      const d = new Date(`${e.date}T00:00:00Z`)
      return d >= previousTradingDay(now) && d <= horizonEnd
    })
    .sort((a, b) => a.date.localeCompare(b.date))

  const pack: Omit<ContextPack, 'approx_tokens'> = {
    generated_at: now.toISOString(),
    brief_type: briefType,
    trading_date: toDateKey(previousTradingDay(now)),
    macro,
    positions: packPositions,
    watchlist: packWatchlist,
    open_recommendations: packOpenRecs,
    news,
    earnings_calendar: earningsCalendar,
    counts: {
      positions: packPositions.length,
      watchlist: packWatchlist.length,
      open_recommendations: packOpenRecs.length,
      news_considered: articles.length,
      news_included: news.length,
    },
  }

  return { ...pack, approx_tokens: approxTokens(pack) }
}

/**
 * Smaller variant for providers with a tight free-tier token-per-minute limit
 * (Groq). Drops most news, trims theses, and reduces watchlist technicals to
 * the three fields that actually drive a decision.
 */
export function toCompactPack(pack: ContextPack): ContextPack {
  const slim = (t: Technicals | null): Technicals | null =>
    t === null
      ? null
      : ({
          ticker: t.ticker,
          last_close: t.last_close,
          change_1d_pct: t.change_1d_pct,
          change_5d_pct: null,
          change_1mo_pct: t.change_1mo_pct,
          rsi_14: t.rsi_14,
          sma_20: null,
          sma_50: null,
          sma_200: null,
          pct_vs_sma_20: null,
          pct_vs_sma_50: t.pct_vs_sma_50,
          pct_vs_sma_200: null,
          high_52w: null,
          low_52w: null,
          pct_from_52w_high: t.pct_from_52w_high,
          pct_from_52w_low: null,
          volume_vs_30d_avg: null,
        } satisfies Technicals)

  const compact: Omit<ContextPack, 'approx_tokens'> = {
    ...pack,
    watchlist: pack.watchlist.map((w) => ({ ...w, technicals: slim(w.technicals) })),
    open_recommendations: pack.open_recommendations.map((r) => ({
      ...r,
      thesis: r.thesis.slice(0, 140),
    })),
    news: pack.news.slice(0, NEWS_CAP_COMPACT).map((n) => ({
      ...n,
      snippet: n.snippet.slice(0, 120),
    })),
    counts: { ...pack.counts, news_included: Math.min(pack.news.length, NEWS_CAP_COMPACT) },
  }

  return { ...compact, approx_tokens: approxTokens(compact) }
}
