/**
 * NYSE trading calendar.
 *
 * Stein 1.0 counted trading days as "any Mon–Fri", which drifted every time a
 * horizon spanned a market holiday. Horizons are how recommendations get
 * auto-closed, so a wrong date closes a trade on the wrong day.
 *
 * Holidays are hardcoded because the free data sources for market calendars are
 * unreliable and this list changes once a year. Extend it before the last entry
 * expires — `assertCalendarCoverage()` warns when the horizon runs short.
 */

// NYSE full-day closures. Half days (early close) are still trading days and
// are deliberately not listed.
const NYSE_HOLIDAYS = new Set<string>([
  // 2026
  '2026-01-01', // New Year's Day
  '2026-01-19', // MLK Jr. Day
  '2026-02-16', // Washington's Birthday
  '2026-04-03', // Good Friday
  '2026-05-25', // Memorial Day
  '2026-06-19', // Juneteenth
  '2026-07-03', // Independence Day (observed)
  '2026-09-07', // Labor Day
  '2026-11-26', // Thanksgiving
  '2026-12-25', // Christmas
  // 2027
  '2027-01-01',
  '2027-01-18',
  '2027-02-15',
  '2027-03-26',
  '2027-05-31',
  '2027-06-18', // Juneteenth (observed)
  '2027-07-05', // Independence Day (observed)
  '2027-09-06',
  '2027-11-25',
  '2027-12-24', // Christmas (observed)
  // 2028
  '2028-01-17',
  '2028-02-21',
  '2028-04-14',
  '2028-05-29',
  '2028-06-19',
  '2028-07-04',
  '2028-09-04',
  '2028-11-23',
  '2028-12-25',
])

const LAST_COVERED_YEAR = 2028

/** `YYYY-MM-DD` in UTC. */
export function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function isWeekend(date: Date): boolean {
  const dow = date.getUTCDay()
  return dow === 0 || dow === 6
}

export function isTradingDay(date: Date): boolean {
  return !isWeekend(date) && !NYSE_HOLIDAYS.has(toDateKey(date))
}

/**
 * Adds N trading days, skipping weekends and NYSE holidays.
 * `n = 0` rolls forward to the next trading day if `date` is not one.
 */
export function addTradingDays(date: Date, n: number): Date {
  const d = new Date(date)
  d.setUTCHours(0, 0, 0, 0)

  if (n <= 0) {
    while (!isTradingDay(d)) d.setUTCDate(d.getUTCDate() + 1)
    return d
  }

  let remaining = n
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + 1)
    if (isTradingDay(d)) remaining--
  }
  return d
}

/** Most recent trading day on or before `date`. */
export function previousTradingDay(date: Date): Date {
  const d = new Date(date)
  d.setUTCHours(0, 0, 0, 0)
  while (!isTradingDay(d)) d.setUTCDate(d.getUTCDate() - 1)
  return d
}

/**
 * Warns when the hardcoded holiday list is close to running out, so horizons
 * silently degrade to weekday-only counting instead of failing unnoticed.
 */
export function assertCalendarCoverage(now: Date = new Date()): void {
  if (now.getUTCFullYear() >= LAST_COVERED_YEAR) {
    console.warn(
      `[marketCalendar] holiday list ends ${LAST_COVERED_YEAR}; add the next years to src/lib/marketCalendar.ts`
    )
  }
}
