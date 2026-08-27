import { createServiceClient } from '@/lib/supabase/server'
import { addTradingDays, toDateKey } from '@/lib/marketCalendar'
import type { BriefContent } from '@/lib/repositories/briefRepo'

/**
 * Demo data.
 *
 * Lets the owner judge the whole UI — brief, scoreboard, portfolio — before any
 * credential exists. Everything it writes is tagged so it can be removed
 * completely; nothing here touches real rows.
 *
 * The sample scoreboard is deliberately *mixed*, including a losing trade and a
 * winner that still lagged SPY. A demo that showed only wins would misrepresent
 * what this system is for.
 */

const DEMO_TAG = '[demo]'
const DEMO_BROKER = 'demo'

const today = () => toDateKey(new Date())
const daysAgo = (n: number) => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d
}

const DEMO_CONTENT: BriefContent = {
  macro_bullets: [
    'SPY closed +0.42% at 601.30; QQQ +0.61%. Breadth was narrow — megacap tech carried the tape.',
    'VIX at 13.8, near the low end of its three-month range. Hedges are cheap relative to realized vol.',
    '10-year yield at 4.21%, down 4bp. Rate-sensitive names caught a bid into the close.',
    'NVDA reports Wednesday after the close — the single largest event risk in this portfolio.',
  ],
  holdings_reviews: [
    {
      ticker: 'AAPL',
      action: 'TRIM',
      rationale:
        'Up 27% from cost and 12% above the 50-day with RSI at 71. Trimming a third locks in the move without giving up exposure to the September product cycle.',
    },
    {
      ticker: 'NVDA',
      action: 'WATCH',
      rationale:
        'Earnings Wednesday after the close. No action before the print — the position is already sized for the volatility. Watch data-center guidance, which is what the current multiple rests on.',
    },
    {
      ticker: 'BMY',
      action: 'HOLD',
      rationale: 'Flat on the year with the 3.1% dividend intact. Nothing in the news flow changes the thesis.',
    },
  ],
  rec_updates: [
    {
      recommendation_id: 'demo-open-1',
      ticker: 'MSFT',
      decision: 'MAINTAIN',
      note: 'Up 3.2% since entry and still 6% clear of the 385 invalidation. Thesis intact — hold to horizon.',
      new_invalidation: null,
    },
  ],
  new_ideas: [
    {
      ticker: 'COST',
      direction: 'LONG',
      thesis:
        'Held the 880 level on three separate tests this month and closed above the 20-day for the first time since July, with membership-fee growth reaffirmed in the latest release. Entry near support keeps the invalidation tight.',
      entry_zone_low: 884,
      entry_zone_high: 892,
      invalidation_price: 866,
      horizon_trading_days: 12,
      conviction: 3,
    },
  ],
  calendar: [
    { date: toDateKey(addTradingDays(new Date(), 2)), label: 'NVDA Q2 earnings (after close)', ticker: 'NVDA' },
    { date: toDateKey(addTradingDays(new Date(), 4)), label: 'Jackson Hole symposium begins', ticker: null },
  ],
}

const DEMO_PACK = {
  generated_at: new Date().toISOString(),
  brief_type: 'PREMARKET',
  trading_date: today(),
  macro: [
    { ticker: 'SPY', last: 601.3, change_1d_pct: 0.42 },
    { ticker: 'QQQ', last: 534.1, change_1d_pct: 0.61 },
    { ticker: '^VIX', last: 13.8, change_1d_pct: -2.9 },
    { ticker: '^TNX', last: 4.21, change_1d_pct: -0.95 },
  ],
  positions: [
    { ticker: 'AAPL', unrealized_pnl_pct: 27.4, technicals: { last_close: 230.5 } },
    { ticker: 'NVDA', unrealized_pnl_pct: -3.2, technicals: { last_close: 150.1 } },
    { ticker: 'BMY', unrealized_pnl_pct: 0.8, technicals: { last_close: 51.2 } },
  ],
  watchlist: [{ ticker: 'COST', technicals: { last_close: 888.4 } }],
  open_recommendations: [
    { id: 'demo-open-1', ticker: 'MSFT', direction: 'LONG', return_pct: 3.2, current_price: 413 },
  ],
  news: [],
  earnings_calendar: [],
  counts: { positions: 3, watchlist: 1, open_recommendations: 1, news_considered: 0, news_included: 0 },
  approx_tokens: 0,
}

export type DemoResult = { ok: true; created: Record<string, number> }

export async function seedDemoData(): Promise<DemoResult> {
  const db = createServiceClient()
  await clearDemoData()

  // ── Positions ──
  const positions = [
    { ticker_symbol: 'AAPL', quantity: 150, avg_cost: 181.2, market_value: 34575, unrealized_pnl: 7395 },
    { ticker_symbol: 'NVDA', quantity: 200, avg_cost: 155.1, market_value: 30020, unrealized_pnl: -1000 },
    { ticker_symbol: 'BMY', quantity: 400, avg_cost: 50.8, market_value: 20480, unrealized_pnl: 160 },
  ].map((p) => ({
    ...p,
    broker: DEMO_BROKER,
    source: 'manual' as const,
    currency: 'USD',
    asset_class: 'STK',
    as_of: new Date().toISOString(),
  }))
  const { error: posErr } = await db.from('positions').upsert(positions, {
    onConflict: 'broker,ticker_symbol',
  })
  if (posErr) throw posErr

  // ── Today's brief ──
  const { data: briefRow, error: briefErr } = await db
    .from('briefs')
    .insert({
      brief_date: today(),
      brief_type: 'ON_DEMAND',
      status: 'GENERATED',
      content: DEMO_CONTENT,
      context_pack: DEMO_PACK,
      requested_model: 'demo',
      model: `${DEMO_TAG} sample`,
      generated_at: new Date().toISOString(),
      emailed_at: new Date().toISOString(),
    })
    .select()
    .single()
  if (briefErr) throw briefErr
  const briefId = (briefRow as { id: string }).id

  // ── Ledger: a deliberately mixed record ──
  const recs = [
    // Open winner
    {
      ticker_symbol: 'MSFT', direction: 'LONG', thesis: `${DEMO_TAG} Broke above the 400 consolidation on 1.8x volume.`,
      entry_zone_low: 398, entry_zone_high: 404, invalidation_price: 385,
      horizon_trading_days: 10, horizon_date: toDateKey(addTradingDays(new Date(), 6)),
      conviction: 4, status: 'OPEN', entry_price: 400.2, benchmark_entry_price: 597.1,
      current_price: 413.0, current_return_pct: 3.2, benchmark_return_pct: 0.7,
      last_priced_at: new Date().toISOString(), created_at: daysAgo(4).toISOString(),
    },
    // Closed winner that beat the index
    {
      ticker_symbol: 'AMD', direction: 'LONG', thesis: `${DEMO_TAG} Datacenter guidance raise.`,
      entry_zone_low: 168, entry_zone_high: 172, invalidation_price: 159,
      horizon_trading_days: 10, horizon_date: toDateKey(daysAgo(2)),
      conviction: 4, status: 'CLOSED_HORIZON', entry_price: 170.0, benchmark_entry_price: 588.0,
      current_price: 184.6, current_return_pct: 8.6, benchmark_return_pct: 2.1,
      close_price: 184.6, closed_at: daysAgo(2).toISOString(),
      last_priced_at: daysAgo(2).toISOString(), created_at: daysAgo(16).toISOString(),
    },
    // Closed winner that LAGGED SPY — the case the scoreboard exists to expose
    {
      ticker_symbol: 'KO', direction: 'LONG', thesis: `${DEMO_TAG} Defensive rotation into staples.`,
      entry_zone_low: 62, entry_zone_high: 64, invalidation_price: 59,
      horizon_trading_days: 15, horizon_date: toDateKey(daysAgo(1)),
      conviction: 2, status: 'CLOSED_HORIZON', entry_price: 63.0, benchmark_entry_price: 580.0,
      current_price: 63.8, current_return_pct: 1.3, benchmark_return_pct: 3.6,
      close_price: 63.8, closed_at: daysAgo(1).toISOString(),
      last_priced_at: daysAgo(1).toISOString(), created_at: daysAgo(22).toISOString(),
    },
    // Stopped out
    {
      ticker_symbol: 'PYPL', direction: 'SHORT', thesis: `${DEMO_TAG} Breakdown below range support.`,
      entry_zone_low: 72, entry_zone_high: 74, invalidation_price: 78,
      horizon_trading_days: 8, horizon_date: toDateKey(daysAgo(3)),
      conviction: 3, status: 'CLOSED_INVALIDATED', entry_price: 73.0, benchmark_entry_price: 585.0,
      current_price: 78.9, current_return_pct: -8.1, benchmark_return_pct: 2.8,
      close_price: 78.9, closed_at: daysAgo(6).toISOString(),
      last_priced_at: daysAgo(6).toISOString(), created_at: daysAgo(14).toISOString(),
    },
    // Closed by a later brief
    {
      ticker_symbol: 'DIS', direction: 'LONG', thesis: `${DEMO_TAG} Parks recovery into the quarter.`,
      entry_zone_low: 96, entry_zone_high: 99, invalidation_price: 91,
      horizon_trading_days: 12, horizon_date: toDateKey(addTradingDays(new Date(), 3)),
      conviction: 3, status: 'CLOSED_BY_MODEL', entry_price: 97.5, benchmark_entry_price: 592.0,
      current_price: 101.2, current_return_pct: 3.8, benchmark_return_pct: 1.6,
      close_price: 101.2, closed_at: daysAgo(1).toISOString(), close_note: `${DEMO_TAG} Catalyst played out early.`,
      last_priced_at: daysAgo(1).toISOString(), created_at: daysAgo(9).toISOString(),
    },
  ].map((r) => ({ ...r, brief_id: briefId }))

  const { error: recErr } = await db.from('recommendations').insert(recs)
  if (recErr) throw recErr

  return { ok: true, created: { positions: positions.length, briefs: 1, recommendations: recs.length } }
}

export async function clearDemoData(): Promise<{ ok: true; removed: Record<string, number> }> {
  const db = createServiceClient()

  // Recommendations first — they reference briefs.
  const { data: recs } = await db
    .from('recommendations')
    .delete()
    .like('thesis', `${DEMO_TAG}%`)
    .select('id')

  const { data: briefs } = await db
    .from('briefs')
    .delete()
    .like('model', `${DEMO_TAG}%`)
    .select('id')

  const { data: positions } = await db
    .from('positions')
    .delete()
    .eq('broker', DEMO_BROKER)
    .select('id')

  return {
    ok: true,
    removed: {
      recommendations: recs?.length ?? 0,
      briefs: briefs?.length ?? 0,
      positions: positions?.length ?? 0,
    },
  }
}
