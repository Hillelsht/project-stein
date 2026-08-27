import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateBrief, type ValidationContext } from '@/lib/services/briefService'
import type { ContextPack } from '@/lib/services/contextPackService'

/**
 * The validation gate is the most consequential logic in the system: it decides
 * what becomes a tracked bet. These tests pin the rules that stop an
 * unscoreable recommendation from ever reaching the ledger.
 */

const pack = {
  brief_type: 'PREMARKET',
  macro: [{ ticker: 'SPY', last: 600, change_1d_pct: 0.4 }],
  positions: [
    { ticker: 'AAPL', technicals: { last_close: 230 } },
    { ticker: 'NVDA', technicals: { last_close: 150 } },
  ],
  watchlist: [
    { ticker: 'MSFT', technicals: { last_close: 400 } },
    { ticker: 'TSLA', technicals: { last_close: 412 } },
  ],
  open_recommendations: [{ id: 'rec-1', ticker: 'NVDA', current_price: 150 }],
  news: [],
} as unknown as ContextPack

const ctx: ValidationContext = {
  pack,
  positionTickers: new Set(['AAPL', 'NVDA']),
  openRecIds: new Map([['rec-1', { ticker: 'NVDA', direction: 'LONG' }]]),
  validTickers: (t) => ['AAPL', 'NVDA', 'MSFT', 'TSLA'].includes(t),
}

const idea = (over: Record<string, unknown>) => ({
  ticker: 'MSFT',
  direction: 'LONG',
  thesis: 'Broke out on volume.',
  entry_zone_low: 398,
  entry_zone_high: 404,
  invalidation_price: 385,
  horizon_trading_days: 10,
  conviction: 4,
  ...over,
})

test('a well-formed LONG idea survives', async () => {
  const { content } = await validateBrief({ new_ideas: [idea({})] }, ctx)
  assert.equal(content.new_ideas.length, 1)
  assert.equal(content.new_ideas[0].ticker, 'MSFT')
})

test('a LONG whose invalidation sits ABOVE the entry is dropped', async () => {
  // This is the critical gate: such a stop can never trigger, so a broken
  // thesis would ride to its horizon unchallenged.
  const { content, dropped } = await validateBrief(
    { new_ideas: [idea({ invalidation_price: 420 })] },
    ctx
  )
  assert.equal(content.new_ideas.length, 0)
  assert.match(dropped.join(' '), /not below entry/)
})

test('a SHORT whose invalidation sits BELOW the entry is dropped', async () => {
  const { content, dropped } = await validateBrief(
    { new_ideas: [idea({ ticker: 'TSLA', direction: 'SHORT', invalidation_price: 300 })] },
    ctx
  )
  assert.equal(content.new_ideas.length, 0)
  assert.match(dropped.join(' '), /not above entry/)
})

test('a valid SHORT (invalidation above entry) survives', async () => {
  const { content } = await validateBrief(
    {
      new_ideas: [
        idea({
          ticker: 'TSLA',
          direction: 'SHORT',
          entry_zone_low: 410,
          entry_zone_high: 415,
          invalidation_price: 430,
        }),
      ],
    },
    ctx
  )
  assert.equal(content.new_ideas.length, 1)
  assert.equal(content.new_ideas[0].direction, 'SHORT')
})

test('an unknown ticker is dropped', async () => {
  const { content, dropped } = await validateBrief({ new_ideas: [idea({ ticker: 'ZZZZ' })] }, ctx)
  assert.equal(content.new_ideas.length, 0)
  assert.match(dropped.join(' '), /unknown ticker/)
})

test('horizon and conviction are clamped rather than rejected', async () => {
  const { content } = await validateBrief(
    { new_ideas: [idea({ horizon_trading_days: 99, conviction: 9 })] },
    ctx
  )
  assert.equal(content.new_ideas[0].horizon_trading_days, 20)
  assert.equal(content.new_ideas[0].conviction, 5)
})

test('no more than three ideas are kept', async () => {
  const many = ['MSFT', 'TSLA', 'AAPL', 'NVDA'].map((t) => idea({ ticker: t, invalidation_price: 1 }))
  const { content } = await validateBrief({ new_ideas: many }, ctx)
  assert.ok(content.new_ideas.length <= 3)
})

test('a holding review for a position that is not held is dropped', async () => {
  const { content, dropped } = await validateBrief(
    {
      holdings_reviews: [
        { ticker: 'AAPL', action: 'TRIM', rationale: 'Extended.' },
        { ticker: 'GOOG', action: 'HOLD', rationale: 'Not owned.' },
      ],
    },
    ctx
  )
  assert.equal(content.holdings_reviews.length, 1)
  assert.match(dropped.join(' '), /not a current position/)
})

test('an unknown holding action is dropped', async () => {
  const { content, dropped } = await validateBrief(
    { holdings_reviews: [{ ticker: 'AAPL', action: 'YOLO', rationale: 'x' }] },
    ctx
  )
  assert.equal(content.holdings_reviews.length, 0)
  assert.match(dropped.join(' '), /unknown action/)
})

test('an update naming a recommendation that is not open is dropped', async () => {
  const { content, dropped } = await validateBrief(
    {
      rec_updates: [
        { recommendation_id: 'rec-1', decision: 'MAINTAIN', note: 'Intact.' },
        { recommendation_id: 'ghost', decision: 'CLOSE', note: 'Nonexistent.' },
      ],
    },
    ctx
  )
  assert.equal(content.rec_updates.length, 1)
  assert.match(dropped.join(' '), /not an open recommendation/)
})

test('empty and malformed input degrade to an empty brief rather than throwing', async () => {
  const { content } = await validateBrief({}, ctx)
  assert.deepEqual(content.new_ideas, [])
  assert.deepEqual(content.macro_bullets, [])

  const junk = await validateBrief(
    { macro_bullets: 'not an array', new_ideas: [null, 42, 'nope'] } as never,
    ctx
  )
  assert.deepEqual(junk.content.new_ideas, [])
})

test('blank macro bullets are stripped', async () => {
  const { content } = await validateBrief({ macro_bullets: ['SPY +0.4%', '', '   '] }, ctx)
  assert.deepEqual(content.macro_bullets, ['SPY +0.4%'])
})
