import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addTradingDays,
  isTradingDay,
  isWeekend,
  previousTradingDay,
  toDateKey,
} from '@/lib/marketCalendar'

const d = (iso: string) => new Date(`${iso}T00:00:00Z`)

test('weekends are not trading days', () => {
  assert.equal(isWeekend(d('2026-08-15')), true) // Saturday
  assert.equal(isWeekend(d('2026-08-16')), true) // Sunday
  assert.equal(isTradingDay(d('2026-08-14')), true) // Friday
})

test('NYSE holidays are not trading days', () => {
  assert.equal(isTradingDay(d('2026-12-25')), false) // Christmas
  assert.equal(isTradingDay(d('2026-11-26')), false) // Thanksgiving
  assert.equal(isTradingDay(d('2026-07-03')), false) // Independence Day observed
  assert.equal(isTradingDay(d('2026-12-24')), true) // half day is still a trading day
})

test('addTradingDays skips holidays, not just weekends', () => {
  // Wed 25 Nov + 1 must land on Fri 27, skipping Thanksgiving.
  assert.equal(toDateKey(addTradingDays(d('2026-11-25'), 1)), '2026-11-27')
  // Thu 24 Dec + 1 must skip Christmas and the weekend, landing on Mon 28.
  assert.equal(toDateKey(addTradingDays(d('2026-12-24'), 1)), '2026-12-28')
})

test('addTradingDays(0) rolls forward off a non-trading day', () => {
  assert.equal(toDateKey(addTradingDays(d('2026-08-15'), 0)), '2026-08-17') // Sat -> Mon
  assert.equal(toDateKey(addTradingDays(d('2026-08-14'), 0)), '2026-08-14') // already trading
})

test('a 20-day horizon spanning a holiday lands later than 20 calendar weekdays', () => {
  // This is the 1.0 defect: weekday-only counting drifted across every holiday.
  const withHolidays = addTradingDays(d('2026-11-20'), 20)
  assert.equal(toDateKey(withHolidays), '2026-12-21')
  assert.equal(isTradingDay(withHolidays), true)
})

test('previousTradingDay walks back over a weekend', () => {
  assert.equal(toDateKey(previousTradingDay(d('2026-08-16'))), '2026-08-14')
  assert.equal(toDateKey(previousTradingDay(d('2026-12-25'))), '2026-12-24')
})
