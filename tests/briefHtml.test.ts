import { test } from 'node:test'
import assert from 'node:assert/strict'
import { briefSubject, renderBriefHtml } from '@/lib/briefHtml'
import type { Brief, BriefContent } from '@/lib/repositories/briefRepo'

const brief = {
  id: 'b1',
  brief_date: '2026-08-17',
  brief_type: 'PREMARKET',
  status: 'GENERATED',
  model: 'claude-opus-5',
} as Brief

const empty: BriefContent = {
  macro_bullets: [],
  holdings_reviews: [],
  rec_updates: [],
  new_ideas: [],
  calendar: [],
}

test('model output is escaped, not injected', () => {
  const html = renderBriefHtml({
    brief,
    content: { ...empty, macro_bullets: ['<script>alert(1)</script> & "quotes"'] },
    recommendations: [],
    pack: null,
    appUrl: null,
  })
  assert.ok(html.includes('&lt;script&gt;'))
  assert.ok(!html.includes('<script>'))
})

test('a brief with no ideas still renders a clear statement', () => {
  const html = renderBriefHtml({ brief, content: empty, recommendations: [], pack: null, appUrl: null })
  assert.ok(html.includes('No new trade ideas today'))
})

test('the subject line carries the decision', () => {
  const busy: BriefContent = {
    ...empty,
    new_ideas: [{ ticker: 'MSFT' }] as BriefContent['new_ideas'],
    holdings_reviews: [
      { ticker: 'AAPL', action: 'TRIM', rationale: 'x' },
      { ticker: 'BMY', action: 'HOLD', rationale: 'y' },
    ],
  }
  // HOLD is not an action worth flagging in the subject; TRIM is.
  assert.equal(briefSubject(brief, busy), 'Stein Pre-market · 2026-08-17 · 1 new idea, 1 position action')
  assert.equal(briefSubject(brief, empty), 'Stein Pre-market · 2026-08-17 · no action')
})

test('evening briefs are labelled as such', () => {
  const evening = { ...brief, brief_type: 'EVENING' } as Brief
  assert.ok(briefSubject(evening, empty).startsWith('Stein Evening wrap'))
})
