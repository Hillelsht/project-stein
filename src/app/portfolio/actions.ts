'use server'

import { revalidatePath } from 'next/cache'
import { deletePosition, upsertManualPosition } from '@/lib/repositories/positionRepo'

/** Manual position entry, for holdings IBKR doesn't report or a second broker. */

export async function addManualPositionAction(formData: FormData): Promise<{ error?: string }> {
  const ticker = String(formData.get('ticker') ?? '').toUpperCase().trim()
  const quantity = Number(formData.get('quantity'))
  const avgCostRaw = String(formData.get('avg_cost') ?? '').trim()
  const avgCost = avgCostRaw === '' ? null : Number(avgCostRaw)

  if (!/^[A-Z.\-]{1,10}$/.test(ticker)) return { error: 'Invalid ticker' }
  if (!Number.isFinite(quantity) || quantity === 0) return { error: 'Quantity must be non-zero' }
  if (avgCost !== null && !Number.isFinite(avgCost)) return { error: 'Invalid average cost' }

  await upsertManualPosition({
    ticker_symbol: ticker,
    quantity,
    avg_cost: avgCost,
    currency: 'USD',
    market_value: null,
    unrealized_pnl: null,
    asset_class: 'STK',
    as_of: new Date().toISOString(),
  })

  revalidatePath('/portfolio')
  return {}
}

export async function deletePositionAction(id: string): Promise<void> {
  await deletePosition(id)
  revalidatePath('/portfolio')
}
