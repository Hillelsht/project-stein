'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import { addTicker, removeTicker } from '@/lib/repositories/watchlistRepo'
import { isValidTicker, searchTickers, BLOCKLIST } from '@/lib/repositories/tickerMasterRepo'

async function requireUser() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return user
}

export async function addTickerAction(symbol: string): Promise<{ error?: string }> {
  const user = await requireUser()
  const ticker = symbol.toUpperCase().trim()

  if (!ticker || ticker.length > 5 || !/^[A-Z]{1,5}$/.test(ticker)) {
    return { error: 'Invalid ticker format' }
  }
  if (BLOCKLIST.has(ticker)) {
    return { error: `${ticker} is not a valid US stock ticker` }
  }

  const valid = await isValidTicker(ticker)
  if (!valid) {
    return { error: `${ticker} not found in ticker database` }
  }

  try {
    await addTicker(user.id, ticker)
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      return { error: `${ticker} is already in your watchlist` }
    }
    throw err
  }

  revalidatePath('/watchlist')
  return {}
}

export async function removeTickerAction(symbol: string): Promise<void> {
  const user = await requireUser()
  await removeTicker(user.id, symbol)
  revalidatePath('/watchlist')
}

export async function searchTickersAction(
  prefix: string,
): Promise<{ ticker_symbol: string; company_name: string | null }[]> {
  return searchTickers(prefix, 10)
}

export async function signOutAction(): Promise<void> {
  const supabase = await createServerClient()
  await supabase.auth.signOut()
  redirect('/login')
}
