const SYSTEM_PROMPT = `You are a financial news analyst. Output ONLY a valid JSON object with these exact fields:

{
  "summary": "Exactly 2 sentences summarizing the event. No editorializing.",
  "economic_impact": "1-2 sentences on sector or macro impact. If none, write 'None'.",
  "tickers": ["TICKER1", "TICKER2"],
  "sentiment": "BULLISH",
  "sentiment_score": 0,
  "confidence": 0,
  "material": true
}

Rules:
- tickers: valid US-listed symbols only (NYSE/NASDAQ). Use ticker symbol, not company name. If you are not confident a ticker is implicated, OMIT it rather than guess. Empty array is acceptable.
- sentiment_score: integer 0-10. 0 = trivial / not market-moving. 10 = major, market-altering event (earnings miss >5%, confirmed M&A, FDA approval/rejection, major lawsuit, fraud finding, bankruptcy).
- confidence: integer 0-10. How sure you are about the sentiment direction. 0 = pure guess, 10 = explicit in article text.
- material: true only if this is the kind of news that typically moves a stock price. Routine investor-day announcements, charity, conferences = false.
- sentiment applies to the PRIMARY ticker. If tickers are affected in opposite directions, choose the one with the largest expected move.
- sentiment must be exactly one of: BULLISH, BEARISH, NEUTRAL
- Do NOT include any text outside the JSON.
- Do NOT wrap the JSON in markdown code fences.
- Do NOT add commentary.`

export const REPAIR_PROMPT =
  'Your previous response was not valid JSON. Return only a valid JSON object matching the required schema. No markdown, no code fences, no commentary.'

export function buildPrompt(title: string, rawContent: string): string {
  const body = rawContent.replace(/^\[SEC_ITEMS:[^\]]+\]\n?/, '').slice(0, 4000)
  return `${SYSTEM_PROMPT}\n\nARTICLE TITLE: ${title}\nARTICLE BODY: ${body}`
}
