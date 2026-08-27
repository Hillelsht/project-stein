import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeTechnicals, rsi, sma } from '@/lib/services/marketDataService'

// Wilder's reference series. Hand-computed: average gain 3.34/14, average loss
// 1.40/14, RS 2.3857 -> RSI 70.46.
const WILDER = [
  44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61,
  46.28, 46.28,
]

test('RSI matches the hand-computed Wilder value', () => {
  const value = rsi(WILDER, 14)
  assert.ok(value !== null)
  assert.ok(Math.abs(value! - 70.46) < 0.01, `expected ~70.46, got ${value}`)
})

test('RSI smoothing recurrence continues correctly', () => {
  const value = rsi([...WILDER, 46.0], 14)
  assert.ok(Math.abs(value! - 66.25) < 0.01, `expected ~66.25, got ${value}`)
})

test('RSI edge cases', () => {
  assert.equal(rsi([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], 14), 100) // all gains
  assert.equal(rsi(new Array(20).fill(10), 14), 50) // flat
  assert.equal(rsi([1, 2, 3], 14), null) // too short
})

test('SMA averages only the trailing window', () => {
  assert.equal(sma([1, 2, 3, 4, 5], 3), 4)
  assert.equal(sma([1, 2], 3), null)
})

test('computeTechnicals derives coherent values from a ramp', () => {
  const bars = Array.from({ length: 260 }, (_, i) => ({ close: 100 + i * 0.5, volume: 1000 + i }))
  const t = computeTechnicals('TEST', bars)
  assert.ok(t !== null)
  assert.equal(t!.last_close, 229.5)
  assert.equal(t!.sma_20, 224.75)
  assert.equal(t!.sma_200, 179.75)
  assert.equal(t!.pct_from_52w_high, 0) // a pure ramp ends at its high
  assert.ok(t!.pct_vs_sma_200! > 0)
})

test('computeTechnicals returns null rather than throwing on empty input', () => {
  assert.equal(computeTechnicals('X', []), null)
})
