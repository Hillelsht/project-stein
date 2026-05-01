import YahooFinance from 'yahoo-finance2'
import type { MarketSignal } from '@/lib/repositories/signalRepo'

// yahoo-finance2 v2+ requires instantiation; the static API is deprecated (returns never)
const yf = new YahooFinance()

// Adds N trading days (Mon–Fri; no public holiday calendar)
function addTradingDays(date: Date, n: number): Date {
  const d = new Date(date)
  let remaining = n
  while (remaining > 0) {
    d.setDate(d.getDate() + 1)
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6) remaining--
  }
  return d
}

// True when enough time has passed that price data should be available
function isHorizonRipe(signalTime: Date, horizon: '1h' | '1d' | '3d' | '7d'): boolean {
  const now = Date.now()
  if (horizon === '1h') {
    // 90 min: 1h for the candle to close + 30 min propagation buffer
    return now >= signalTime.getTime() + 90 * 60_000
  }
  const daysMap = { '1d': 1, '3d': 3, '7d': 7 } as const
  const targetDay = addTradingDays(signalTime, daysMap[horizon])
  targetDay.setUTCHours(22, 0, 0, 0) // US markets close ~21:00 UTC; 22:00 gives buffer
  return now >= targetDay.getTime()
}

// Closing price on or after targetDate, skipping weekends / market holidays
export async function getClosingPriceAt(ticker: string, targetDate: Date): Promise<number | null> {
  const period1 = new Date(targetDate)
  period1.setDate(period1.getDate() - 1) // one day before to handle timezone edge cases
  const period2 = new Date(targetDate)
  period2.setDate(period2.getDate() + 10) // look forward up to 10 days (covers holidays)

  try {
    const rows = await yf.historical(ticker, {
      period1: period1.toISOString().split('T')[0],
      period2: period2.toISOString().split('T')[0],
    })
    if (!rows.length) return null

    const target = new Date(targetDate)
    target.setUTCHours(0, 0, 0, 0)

    for (const row of rows) {
      const rowDay = new Date(row.date)
      rowDay.setUTCHours(0, 0, 0, 0)
      if (rowDay >= target) return row.close
    }
    return null
  } catch {
    return null
  }
}

// Price at a specific time horizon after the signal was created.
// Returns null when the horizon has not yet ripened or data is unavailable.
export async function getPriceAtHorizon(
  signal: MarketSignal,
  horizon: '1h' | '1d' | '3d' | '7d',
): Promise<number | null> {
  const signalTime = new Date(signal.created_at)
  if (!isHorizonRipe(signalTime, horizon)) return null

  if (horizon === '1h') {
    const targetTime = new Date(signalTime.getTime() + 60 * 60_000)
    const period2 = new Date(targetTime.getTime() + 30 * 60_000)

    try {
      const result = await yf.chart(signal.ticker_symbol, {
        period1: signalTime,
        period2,
        interval: '1h',
      })
      for (const q of result?.quotes ?? []) {
        if (q.date && new Date(q.date).getTime() >= targetTime.getTime()) {
          return typeof q.close === 'number' ? q.close : null
        }
      }
      return null
    } catch {
      return null
    }
  }

  const daysMap = { '1d': 1, '3d': 3, '7d': 7 } as const
  return getClosingPriceAt(signal.ticker_symbol, addTradingDays(signalTime, daysMap[horizon]))
}
