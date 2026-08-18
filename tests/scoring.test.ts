import { test } from 'node:test'
import assert from 'node:assert/strict'
import { directionalReturn, isInvalidated, isPastHorizon } from '@/lib/services/scoringService'
import type { Recommendation } from '@/lib/repositories/recommendationRepo'

const rec = (over: Partial<Recommendation>): Recommendation =>
  ({
    id: 'r1',
    direction: 'LONG',
    invalidation_price: 90,
    horizon_date: '2026-08-20',
    ...over,
  }) as Recommendation

test('returns are direction-aware', () => {
  assert.equal(directionalReturn(100, 110, 'LONG'), 10)
  assert.equal(directionalReturn(100, 90, 'LONG'), -10)
  // The one that is easy to get backwards: a short profits when price falls.
  assert.equal(directionalReturn(100, 90, 'SHORT'), 10)
  assert.equal(directionalReturn(100, 110, 'SHORT'), -10)
})

test('returns are null when there is no basis to measure from', () => {
  assert.equal(directionalReturn(null, 110, 'LONG'), null)
  assert.equal(directionalReturn(100, null, 'LONG'), null)
  assert.equal(directionalReturn(0, 110, 'LONG'), null)
})

test('LONG invalidation triggers at or below the stop', () => {
  const r = rec({ direction: 'LONG', invalidation_price: 90 })
  assert.equal(isInvalidated(r, 95), false)
  assert.equal(isInvalidated(r, 90), true) // exactly at the stop counts
  assert.equal(isInvalidated(r, 85), true)
})

test('SHORT invalidation triggers at or above the stop', () => {
  const r = rec({ direction: 'SHORT', invalidation_price: 110 })
  assert.equal(isInvalidated(r, 105), false)
  assert.equal(isInvalidated(r, 110), true)
  assert.equal(isInvalidated(r, 115), true)
})

test('horizon closes on the date, not after it', () => {
  const r = rec({ horizon_date: '2026-08-20' })
  assert.equal(isPastHorizon(r, new Date('2026-08-19T12:00:00Z')), false)
  assert.equal(isPastHorizon(r, new Date('2026-08-20T12:00:00Z')), true)
  assert.equal(isPastHorizon(r, new Date('2026-08-25T12:00:00Z')), true)
})
