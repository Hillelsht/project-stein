import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseOpenPositions } from '@/lib/services/flexService'

const STATEMENT = `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse><FlexStatements count="1"><FlexStatement accountId="U1" period="LastBusinessDay">
<OpenPositions>
<OpenPosition currency="USD" assetCategory="STK" symbol="AAPL" position="100" markPrice="230.50" positionValue="23050" costBasisPrice="180.25" fifoPnlUnrealized="5025" reportDate="20260814" />
<OpenPosition currency="USD" assetCategory="STK" symbol="AAPL" position="50" markPrice="230.50" positionValue="11525" costBasisPrice="200.00" fifoPnlUnrealized="1525" reportDate="20260814" />
<OpenPosition currency="USD" assetCategory="STK" symbol="NVDA" position="-40" markPrice="150.00" positionValue="-6000" costBasisPrice="165.00" fifoPnlUnrealized="600" reportDate="20260814" />
<OpenPosition currency="USD" assetCategory="OPT" symbol="AAPL  260918C00250000" position="5" markPrice="4.20" positionValue="2100" reportDate="20260814" />
<OpenPosition currency="USD" assetCategory="STK" symbol="TSLA" position="0" markPrice="410.00" positionValue="0" reportDate="20260814" />
</OpenPositions>
</FlexStatement></FlexStatements></FlexQueryResponse>`

test('multiple lots of one symbol aggregate with a quantity-weighted cost basis', () => {
  const { positions } = parseOpenPositions(STATEMENT)
  const aapl = positions.find((p) => p.ticker_symbol === 'AAPL')
  assert.ok(aapl)
  assert.equal(aapl!.quantity, 150)
  // (180.25*100 + 200.00*50) / 150
  assert.ok(Math.abs(aapl!.avg_cost! - 186.8333) < 0.001)
  assert.equal(aapl!.market_value, 34575)
  assert.equal(aapl!.unrealized_pnl, 6550)
})

test('short positions keep their negative quantity', () => {
  const { positions } = parseOpenPositions(STATEMENT)
  const nvda = positions.find((p) => p.ticker_symbol === 'NVDA')
  assert.equal(nvda!.quantity, -40)
})

test('non-equity rows are skipped and counted', () => {
  const { positions, skipped } = parseOpenPositions(STATEMENT)
  assert.equal(skipped, 1)
  assert.ok(!positions.some((p) => p.ticker_symbol.includes('260918C')))
})

test('closed lots are dropped', () => {
  const { positions } = parseOpenPositions(STATEMENT)
  assert.ok(!positions.some((p) => p.ticker_symbol === 'TSLA'))
})

test('IBKR YYYYMMDD report dates become ISO timestamps', () => {
  const { positions } = parseOpenPositions(STATEMENT)
  assert.equal(positions[0].as_of, '2026-08-14T00:00:00Z')
})

test('an empty statement parses to nothing rather than throwing', () => {
  const { positions, skipped } = parseOpenPositions(
    '<FlexQueryResponse><OpenPositions></OpenPositions></FlexQueryResponse>'
  )
  assert.deepEqual(positions, [])
  assert.equal(skipped, 0)
})
