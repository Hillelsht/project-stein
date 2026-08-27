import YahooFinance from 'yahoo-finance2'

/**
 * Market data for the brief context pack: technicals, macro, earnings dates.
 *
 * Everything here is computed in code rather than asked of the model. An LLM
 * cannot reliably compute an RSI from a list of closes, but it can reason well
 * about "RSI 28, 12% below the 50-day, earnings in 3 days" — so the numbers are
 * produced deterministically and handed over as facts.
 */

const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] })

// Yahoo is unauthenticated and rate-sensitive; calls are sequential with a
// small gap. ~30 tickers ≈ 10s, comfortably inside the brief route budget.
const PACING_MS = 300

export const MACRO_TICKERS = ['SPY', 'QQQ', '^VIX', '^TNX'] as const

export type Technicals = {
  ticker: string
  last_close: number
  change_1d_pct: number | null
  change_5d_pct: number | null
  change_1mo_pct: number | null
  rsi_14: number | null
  sma_20: number | null
  sma_50: number | null
  sma_200: number | null
  pct_vs_sma_20: number | null
  pct_vs_sma_50: number | null
  pct_vs_sma_200: number | null
  high_52w: number | null
  low_52w: number | null
  pct_from_52w_high: number | null
  pct_from_52w_low: number | null
  volume_vs_30d_avg: number | null
}

export type MacroQuote = {
  ticker: string
  last: number
  change_1d_pct: number | null
}

export type EarningsDate = {
  ticker: string
  date: string // YYYY-MM-DD
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function round(value: number | null, dp = 2): number | null {
  if (value === null || !Number.isFinite(value)) return null
  const f = 10 ** dp
  return Math.round(value * f) / f
}

function pctChange(from: number, to: number): number | null {
  if (!Number.isFinite(from) || from === 0) return null
  return ((to - from) / from) * 100
}

// ── Pure indicator maths (exported for testing) ──────────────────────────────

export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null
  let sum = 0
  for (let i = values.length - period; i < values.length; i++) sum += values[i]
  return sum / period
}

/**
 * Wilder's RSI — the standard used by charting platforms. A simple-average RSI
 * gives visibly different numbers, which would make the brief disagree with
 * whatever chart the owner is looking at.
 */
export function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null

  let gainSum = 0
  let lossSum = 0
  for (let i = 1; i <= period; i++) {
    const delta = closes[i] - closes[i - 1]
    if (delta >= 0) gainSum += delta
    else lossSum -= delta
  }

  let avgGain = gainSum / period
  let avgLoss = lossSum / period

  for (let i = period + 1; i < closes.length; i++) {
    const delta = closes[i] - closes[i - 1]
    const gain = delta > 0 ? delta : 0
    const loss = delta < 0 ? -delta : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
  }

  if (avgLoss === 0) return avgGain === 0 ? 50 : 100
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

// ── Yahoo access ─────────────────────────────────────────────────────────────

type Bar = { close: number; volume: number | null }

async function fetchDailyBars(ticker: string, days: number): Promise<Bar[]> {
  const period1 = new Date()
  period1.setUTCDate(period1.getUTCDate() - days)

  const result = await yf.chart(ticker, { period1, interval: '1d' })
  const bars: Bar[] = []
  for (const q of result?.quotes ?? []) {
    if (typeof q.close === 'number' && Number.isFinite(q.close)) {
      bars.push({ close: q.close, volume: typeof q.volume === 'number' ? q.volume : null })
    }
  }
  return bars
}

export function computeTechnicals(ticker: string, bars: Bar[]): Technicals | null {
  if (bars.length === 0) return null

  const closes = bars.map((b) => b.close)
  const last = closes[closes.length - 1]

  const at = (backOffset: number): number | null =>
    closes.length > backOffset ? closes[closes.length - 1 - backOffset] : null

  const prev1 = at(1)
  const prev5 = at(5)
  const prev21 = at(21) // ~1 month of trading days

  const sma20 = sma(closes, 20)
  const sma50 = sma(closes, 50)
  const sma200 = sma(closes, 200)

  const window52w = closes.slice(-252)
  const high52 = window52w.length ? Math.max(...window52w) : null
  const low52 = window52w.length ? Math.min(...window52w) : null

  const volumes = bars.map((b) => b.volume).filter((v): v is number => v !== null)
  const lastVolume = volumes.length ? volumes[volumes.length - 1] : null
  const avgVolume30 = volumes.length >= 30 ? sma(volumes, 30) : null

  return {
    ticker,
    last_close: round(last)!,
    change_1d_pct: round(prev1 !== null ? pctChange(prev1, last) : null),
    change_5d_pct: round(prev5 !== null ? pctChange(prev5, last) : null),
    change_1mo_pct: round(prev21 !== null ? pctChange(prev21, last) : null),
    rsi_14: round(rsi(closes, 14), 1),
    sma_20: round(sma20),
    sma_50: round(sma50),
    sma_200: round(sma200),
    pct_vs_sma_20: round(sma20 !== null ? pctChange(sma20, last) : null),
    pct_vs_sma_50: round(sma50 !== null ? pctChange(sma50, last) : null),
    pct_vs_sma_200: round(sma200 !== null ? pctChange(sma200, last) : null),
    high_52w: round(high52),
    low_52w: round(low52),
    pct_from_52w_high: round(high52 !== null ? pctChange(high52, last) : null),
    pct_from_52w_low: round(low52 !== null ? pctChange(low52, last) : null),
    volume_vs_30d_avg:
      lastVolume !== null && avgVolume30 !== null && avgVolume30 > 0
        ? round(lastVolume / avgVolume30)
        : null,
  }
}

export async function getTechnicals(ticker: string): Promise<Technicals | null> {
  try {
    // ~400 calendar days ≈ 275 trading days: enough for SMA200 and a 52-week range.
    const bars = await fetchDailyBars(ticker, 400)
    return computeTechnicals(ticker, bars)
  } catch (err) {
    console.warn(`[marketData] technicals failed for ${ticker}:`, (err as Error).message)
    return null
  }
}

/** Technicals for many tickers, paced to stay friendly to Yahoo. */
export async function getTechnicalsBatch(tickers: string[]): Promise<Map<string, Technicals>> {
  const out = new Map<string, Technicals>()
  for (const ticker of tickers) {
    const t = await getTechnicals(ticker)
    if (t) out.set(ticker, t)
    await sleep(PACING_MS)
  }
  return out
}

export async function getMacroSnapshot(): Promise<MacroQuote[]> {
  const out: MacroQuote[] = []
  for (const ticker of MACRO_TICKERS) {
    try {
      const bars = await fetchDailyBars(ticker, 10)
      if (bars.length === 0) continue
      const last = bars[bars.length - 1].close
      const prev = bars.length > 1 ? bars[bars.length - 2].close : null
      out.push({
        ticker,
        last: round(last)!,
        change_1d_pct: round(prev !== null ? pctChange(prev, last) : null),
      })
    } catch (err) {
      console.warn(`[marketData] macro failed for ${ticker}:`, (err as Error).message)
    }
    await sleep(PACING_MS)
  }
  return out
}

export async function getEarningsDates(tickers: string[]): Promise<EarningsDate[]> {
  const out: EarningsDate[] = []
  for (const ticker of tickers) {
    try {
      const summary = await yf.quoteSummary(ticker, { modules: ['calendarEvents'] })
      const raw = summary?.calendarEvents?.earnings?.earningsDate?.[0]
      if (raw) {
        const date = raw instanceof Date ? raw : new Date(raw as unknown as string)
        if (!Number.isNaN(date.getTime())) {
          out.push({ ticker, date: date.toISOString().slice(0, 10) })
        }
      }
    } catch {
      // Many tickers (ETFs, indices) have no earnings module — not an error.
    }
    await sleep(PACING_MS)
  }
  return out
}

/** Latest close for a single ticker — used by the scoring job. */
export async function getLastClose(ticker: string): Promise<number | null> {
  try {
    const bars = await fetchDailyBars(ticker, 10)
    return bars.length ? round(bars[bars.length - 1].close) : null
  } catch {
    return null
  }
}
