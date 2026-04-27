# Project Stein — Data Pipeline

## Why a pre-filter pipeline exists

Raw RSS feeds produce 5,000–10,000 articles/day. Gemini free tier allows 1,000 LLM calls/day (we cap at 800). Without filtering, the budget is exhausted in minutes. The pipeline's job is to reduce that fire hose to the ~50–150 articles/day that actually matter.

## End-to-end flow

```
RSS item arrives
     │
     ▼
[Ingest] rssService.fetchSource()
  - Parse RSS/Atom with rss-parser
  - Set SEC User-Agent header (required by SEC)
  - Save to articles table (url UNIQUE prevents exact dups at DB level)
  - Extract 8-K item codes from SEC feed titles/summaries into raw_content
     │
     ▼
[Filter Stage 1] Ticker extraction
  - Regex: /(?:^|[^A-Z])\$?([A-Z]{1,5})(?:[^A-Z]|$)/g
  - Cross-reference every candidate against tickers_master
  - Blocklist removes common false positives: CEO, CFO, SEC, FDA, USA, GDP, etc.
  - No valid ticker → article can still proceed if Stage 2 matches (macro news)
     │
     ▼
[Filter Stage 2] Material keyword filter
  - Article must contain at least one keyword (case-insensitive, word-boundary):
    M&A: acquire, merger, buyout, takeover, divestiture, spinoff
    Earnings: EPS, guidance, beat, miss, raised, lowered, warning, preannounce
    Regulatory: FDA, approval, recall, 510(k), phase 1/2/3, PDUFA, breakthrough
    Legal: lawsuit, settlement, SEC charges, fraud, investigation, class action
    Leadership: resigns, fired, appointed, steps down, terminated
    Capital: buyback, dividend, offering, bankruptcy, Chapter 11, 13D, 13G, activist
    Operations: contract awarded, patent granted, joint venture, license agreement
  - Fail → reject reason: "no_material_keyword"
     │
     ▼
[Filter Stage 3] SEC 8-K item filter (SEC source only)
  - Accept only filings containing material items:
    1.01 Material Definitive Agreement
    1.02 Termination of Agreement
    1.03 Bankruptcy
    2.01 Completion of Acquisition
    2.02 Results of Operations (earnings)
    3.01 Notice of Delisting
    4.02 Non-Reliance on Financial Statements
    5.02 Officer Departure / Compensation
    7.01 Regulation FD
    8.01 Other Events
  - Drop filings with only items 5.03, 5.07, 9.01 (immaterial)
  - Fail → reject reason: "immaterial_sec_item"
     │
     ▼
[Filter Stage 4] Deduplication
  - hash = SHA-256(normalized_title + "|" + raw_content[:200])
  - normalized_title = title.lowercase().replace(/[^a-z0-9 ]/g, '').trim()
  - Check dedup_hashes for past 48 hours
  - Hit → reject reason: "duplicate"
  - Miss → save hash to dedup_hashes
     │
     ▼
[Filter Stage 5] Watchlist priority
  - If extracted tickers ∩ any user's watchlist → mark high-priority (always send to LLM)
  - Else → low-priority (only send if daily budget allows)
     │
     ▼
[Filter Stage 6] Daily LLM budget check
  - countAnalysesToday() >= 800 → reject reason: "daily_budget"
  - Budget resets at midnight UTC
     │
     ▼
[LLM] llmService.analyzeArticle()
  1. Build prompt from sentimentPrompt template (title + body truncated to 4,000 chars)
  2. Call Gemini 2.5 Flash-Lite (REST API, responseMimeType: application/json)
  3. On 429 or 5xx → fall back to Groq (Llama 3.3 70B)
  4. On both fail → log, skip article
  5. JSON.parse() — one retry with repair prompt on failure
  6. Validate each ticker in response against tickers_master → drop hallucinations
  7. Clamp sentiment_score and confidence to 0–10
  8. Uppercase sentiment → default NEUTRAL if invalid
  9. Save ai_analyses row (with token counts for budget tracking)
  10. Save market_signals row(s) for each valid ticker
  11. If score ≥ 8 AND ticker in any user's watchlist → send push notification
     │
     ▼
[Validation] validationService (runs daily at 02:00 UTC)
  - For each signal from past 10 days where price horizons are still null:
    1. Fetch historical prices via yahoo-finance2
    2. Compute return at 1h, 1d, 3d, 7d horizons (market time, not wall-clock)
    3. Upsert into signal_outcomes
  - After 60+ days of data: /stats page shows whether signals actually have edge
```

## LLM prompt (verbatim system prompt)

```
You are a financial news analyst. Output ONLY a valid JSON object with these exact fields:

{
  "summary": "Exactly 2 sentences summarizing the event. No editorializing.",
  "economic_impact": "1-2 sentences on sector or macro impact. If none, write 'None'.",
  "tickers": ["TICKER1", "TICKER2"],
  "sentiment": "BULLISH" | "BEARISH" | "NEUTRAL",
  "sentiment_score": 0,
  "confidence": 0,
  "material": true
}

Rules:
- tickers: valid US-listed symbols only. If not confident, OMIT rather than guess.
- sentiment_score: 0-10. 10 = major market-moving event (earnings miss >5%, M&A, FDA decision, bankruptcy).
- confidence: 0-10. How sure you are about the direction.
- material: true only if news typically moves stock price.
- sentiment applies to PRIMARY ticker.
- Do NOT include any text outside the JSON.
- Do NOT wrap in markdown code fences.

ARTICLE TITLE: {title}
ARTICLE BODY: {body_truncated_4000_chars}
```

## LLM response validation

After every LLM call, before any DB insert:
1. `JSON.parse()` — one retry with repair prompt on failure; skip on second failure
2. Each `tickers[]` entry checked against `tickers_master` — hallucinated symbols silently dropped
3. `sentiment_score`, `confidence` → clamped to integers 0–10
4. `sentiment` → uppercase; must be BULLISH/BEARISH/NEUTRAL; else NEUTRAL
5. If no valid tickers AND `material = false` → save `ai_analyses` row but skip `market_signals` (keeps audit trail)

## Push notification trigger

Conditions (all must be true):
- `sentiment_score >= 8`
- `ticker_symbol` is in at least one user's watchlist
- User has not received > 10 pushes today
- Same ticker was not pushed to this user in the past 30 minutes

Payload:
```json
{ "title": "TSLA · BULLISH · 9/10", "body": "2-sentence summary...", "url": "/?highlight={signal_id}" }
```
