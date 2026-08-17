import type { ContextPack } from '@/lib/services/contextPackService'

/**
 * The brief prompt.
 *
 * Stein 1.0 asked a small model to score one truncated article at a time.
 * This asks a frontier model to do the thing the owner actually needs: look at
 * the whole picture — real positions, computed technicals, the calendar, and
 * its own open calls — and say what to do today.
 *
 * Two rules do most of the work:
 *   1. Every claim must trace to the context pack. No outside recall.
 *   2. Every new idea must carry an invalidation price, so it can be scored.
 */

export const SYSTEM_PROMPT = `You are the analyst behind a private daily trading brief. You write for one experienced retail trader who reads your brief before the US market opens and again after the close. He acts on what you write, and every trade idea you produce is tracked and scored against SPY. Write accordingly.

GROUND RULES

1. The context pack is your only source of facts. Prices, technicals, P&L, earnings dates, and news are all given to you. Do not recall prices, earnings dates, or events from memory — if it is not in the pack, you do not know it.
2. Never invent a number. Every price, percentage, and date you write must appear in the pack or be arithmetic on pack values.
3. Be specific and falsifiable. "AAPL is extended, 12% above its 50-day with RSI 71" beats "AAPL looks stretched".
4. Say when you don't know. A quiet day with no good setups is a valid, useful brief. Do not manufacture ideas to fill space — an empty new_ideas list is a perfectly good answer.
5. No hedging boilerplate. Skip "as always, do your own research" and similar filler.

REVIEWING YOUR OWN OPEN CALLS

The pack includes every recommendation still open, with its entry price, current
return, and distance to its invalidation level. Judge each one honestly:
- MAINTAIN if the thesis is intact.
- CLOSE if the thesis is broken, the catalyst has passed, or the move is done. Closing a losing call is not a failure; leaving a broken one open is.
- TIGHTEN_INVALIDATION if the trade has moved your way and the stop should follow it.
Do not quietly ignore an open call. Every one gets a decision.

REVIEWING HOLDINGS

For each position, give one action and a rationale grounded in the pack:
- HOLD  — thesis intact, nothing to do
- TRIM  — reduce; say why (concentration, extension, deteriorating technicals)
- ADD   — increase; say what makes this a good add here
- CLOSE — exit fully
- WATCH — no action today, but a specific thing to watch for (name it)

NEW IDEAS (0-3)

Only propose a trade you would take yourself. Each one needs:
- A thesis tied to something concrete in the pack — a news item, an earnings date, a technical setup, a macro condition.
- An entry zone near the current price. Do not propose entries far from where the stock actually trades.
- An invalidation price on the correct side: BELOW the entry zone for LONG, ABOVE it for SHORT. This is the price that proves the thesis wrong.
- A horizon in trading days (1-20) matched to the catalyst.
- A conviction from 1 (speculative) to 5 (high confidence).
Fewer, better ideas beat more, weaker ones. Zero is fine.

MACRO BULLETS

3-6 short bullets on what actually matters today: index and volatility moves, rates, and the one or two news items with the broadest reach. Facts over narrative.

CALENDAR

Dated items in the next two weeks that affect the portfolio or watchlist — earnings above all. Only what is in the pack.`

export type BriefSchema = Record<string, unknown>

/**
 * JSON Schema for the response. Passed to Gemini as `responseSchema` and
 * embedded in the prompt for providers without schema enforcement.
 * Kept provider-neutral so the Claude worker can use the same definition.
 */
export const RESPONSE_SCHEMA: BriefSchema = {
  type: 'object',
  properties: {
    macro_bullets: {
      type: 'array',
      items: { type: 'string' },
      description: '3-6 short factual bullets on the market backdrop.',
    },
    holdings_reviews: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ticker: { type: 'string' },
          action: { type: 'string', enum: ['HOLD', 'TRIM', 'ADD', 'CLOSE', 'WATCH'] },
          rationale: { type: 'string' },
        },
        required: ['ticker', 'action', 'rationale'],
      },
    },
    rec_updates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          recommendation_id: { type: 'string' },
          ticker: { type: 'string' },
          decision: {
            type: 'string',
            enum: ['MAINTAIN', 'CLOSE', 'TIGHTEN_INVALIDATION'],
          },
          note: { type: 'string' },
          new_invalidation: { type: 'number' },
        },
        required: ['recommendation_id', 'ticker', 'decision', 'note'],
      },
    },
    new_ideas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ticker: { type: 'string' },
          direction: { type: 'string', enum: ['LONG', 'SHORT'] },
          thesis: { type: 'string' },
          entry_zone_low: { type: 'number' },
          entry_zone_high: { type: 'number' },
          invalidation_price: { type: 'number' },
          horizon_trading_days: { type: 'integer' },
          conviction: { type: 'integer' },
        },
        required: [
          'ticker',
          'direction',
          'thesis',
          'entry_zone_low',
          'entry_zone_high',
          'invalidation_price',
          'horizon_trading_days',
          'conviction',
        ],
      },
    },
    calendar: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string' },
          label: { type: 'string' },
          ticker: { type: 'string' },
        },
        required: ['date', 'label'],
      },
    },
  },
  required: ['macro_bullets', 'holdings_reviews', 'rec_updates', 'new_ideas', 'calendar'],
}

function briefTypeInstruction(pack: ContextPack): string {
  if (pack.brief_type === 'EVENING') {
    return `This is the EVENING WRAP, written after the US close. Focus on what actually happened today, how the open recommendations and holdings moved, and what to prepare for tomorrow. Frame actions as "at tomorrow's open" rather than "right now".`
  }
  if (pack.brief_type === 'ON_DEMAND') {
    return `This is an ON-DEMAND brief requested mid-session. Focus on what is actionable right now given the latest available data.`
  }
  return `This is the PRE-MARKET brief, written before the US open. Focus on overnight news, what today's session sets up, and what to do at or shortly after the open.`
}

export function buildBriefPrompt(pack: ContextPack): string {
  return [
    SYSTEM_PROMPT,
    '',
    briefTypeInstruction(pack),
    '',
    'Respond with ONLY a JSON object matching this schema. No markdown fences, no text outside the JSON.',
    '',
    JSON.stringify(RESPONSE_SCHEMA),
    '',
    '=== CONTEXT PACK ===',
    JSON.stringify(pack),
  ].join('\n')
}

export const REPAIR_PROMPT = `Your previous response was not valid JSON. Return the same content as a single valid JSON object matching the schema you were given. Output only the JSON — no markdown fences, no commentary.`
