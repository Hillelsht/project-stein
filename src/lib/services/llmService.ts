import { buildPrompt, REPAIR_PROMPT } from '@/lib/prompts/sentimentPrompt'
import { validateTickerBatch } from '@/lib/repositories/tickerMasterRepo'
import { countAnalysesToday, saveAnalysis } from '@/lib/repositories/analysisRepo'
import { saveSignal } from '@/lib/repositories/signalRepo'
import type { Article } from '@/lib/repositories/articleRepo'
import type { Sentiment } from '@/lib/repositories/signalRepo'

// Update these if the provider releases a newer free-tier model.
const GEMINI_MODEL = 'gemini-2.5-flash-lite'
const GROQ_MODEL   = 'llama-3.3-70b-versatile'

const LLM_DAILY_BUDGET = 800

type LLMRaw = {
  summary?: unknown
  economic_impact?: unknown
  tickers?: unknown
  sentiment?: unknown
  sentiment_score?: unknown
  confidence?: unknown
  material?: unknown
}

// ── Gemini ───────────────────────────────────────────────────────────────────

async function callGemini(
  prompt: string
): Promise<{ text: string; tokensIn: number; tokensOut: number } | null> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY not set')

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
    }),
  })

  if (res.status === 429 || res.status >= 500) return null // signal fallback
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Gemini ${res.status}: ${body.slice(0, 200)}`)
  }

  const json = await res.json()
  const text: string = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  const tokensIn: number  = json?.usageMetadata?.promptTokenCount ?? 0
  const tokensOut: number = json?.usageMetadata?.candidatesTokenCount ?? 0
  return { text, tokensIn, tokensOut }
}

// ── Groq (OpenAI-compatible) ─────────────────────────────────────────────────

async function callGroq(
  prompt: string
): Promise<{ text: string; tokensIn: number; tokensOut: number } | null> {
  const key = process.env.GROQ_API_KEY
  if (!key) throw new Error('GROQ_API_KEY not set')

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      response_format: { type: 'json_object' },
    }),
  })

  if (res.status === 429 || res.status >= 500) return null
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Groq ${res.status}: ${body.slice(0, 200)}`)
  }

  const json = await res.json()
  const text: string  = json?.choices?.[0]?.message?.content ?? ''
  const tokensIn: number  = json?.usage?.prompt_tokens ?? 0
  const tokensOut: number = json?.usage?.completion_tokens ?? 0
  return { text, tokensIn, tokensOut }
}

// ── JSON parse with one repair attempt ──────────────────────────────────────

async function callWithFallback(
  prompt: string
): Promise<{ text: string; tokensIn: number; tokensOut: number; provider: string } | null> {
  let result = await callGemini(prompt)
  let provider = GEMINI_MODEL

  if (!result) {
    result = await callGroq(prompt)
    provider = `groq-${GROQ_MODEL}`
  }

  if (!result) {
    console.warn('[llm] both providers failed or rate-limited')
    return null
  }

  return { ...result, provider }
}

function parseJson(text: string): LLMRaw | null {
  try {
    return JSON.parse(text) as LLMRaw
  } catch {
    return null
  }
}

async function fetchParsedResponse(
  prompt: string
): Promise<{ raw: LLMRaw; tokensIn: number; tokensOut: number; provider: string } | null> {
  const first = await callWithFallback(prompt)
  if (!first) return null

  const parsed = parseJson(first.text)
  if (parsed) return { raw: parsed, tokensIn: first.tokensIn, tokensOut: first.tokensOut, provider: first.provider }

  // One repair attempt using the same provider pathway
  console.warn('[llm] JSON parse failed, attempting repair')
  const repair = await callWithFallback(
    `${REPAIR_PROMPT}\n\nOriginal article prompt:\n${prompt.slice(0, 500)}`
  )
  if (!repair) return null

  const reparsed = parseJson(repair.text)
  if (!reparsed) {
    console.warn('[llm] repair also failed to produce valid JSON')
    return null
  }

  return { raw: reparsed, tokensIn: first.tokensIn + repair.tokensIn, tokensOut: first.tokensOut + repair.tokensOut, provider: first.provider }
}

// ── Response validation & normalisation ─────────────────────────────────────

const VALID_SENTIMENTS = new Set<string>(['BULLISH', 'BEARISH', 'NEUTRAL'])

function clamp(value: unknown, min: number, max: number): number {
  const n = Math.round(Number(value))
  if (!isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

function normaliseSentiment(value: unknown): Sentiment {
  const s = String(value ?? '').toUpperCase().trim()
  return VALID_SENTIMENTS.has(s) ? (s as Sentiment) : 'NEUTRAL'
}

// ── Main export ──────────────────────────────────────────────────────────────

export async function analyzeArticle(article: Article): Promise<void> {
  // Budget guard
  const todayCount = await countAnalysesToday()
  if (todayCount >= LLM_DAILY_BUDGET) {
    console.log(`[llm] daily budget reached (${todayCount}), skipping article ${article.id}`)
    return
  }

  const prompt = buildPrompt(article.title, article.raw_content ?? '')
  const response = await fetchParsedResponse(prompt)

  if (!response) {
    console.warn(`[llm] no usable response for article ${article.id}`)
    return
  }

  const { raw, tokensIn, tokensOut, provider } = response

  // Validate & clean
  const sentiment       = normaliseSentiment(raw.sentiment)
  const sentimentScore  = clamp(raw.sentiment_score, 0, 10)
  const confidence      = clamp(raw.confidence, 0, 10)
  const summary         = typeof raw.summary === 'string' ? raw.summary : ''
  const economicImpact  = typeof raw.economic_impact === 'string' ? raw.economic_impact : null
  const material        = raw.material === true

  // Validate tickers — drop any hallucinations
  const rawTickers = Array.isArray(raw.tickers)
    ? (raw.tickers as unknown[]).filter((t): t is string => typeof t === 'string')
    : []

  const validTickers = await validateTickerBatch(
    rawTickers.map((t) => t.toUpperCase().trim()).filter(Boolean)
  )

  const hallucinated = rawTickers.filter((t) => !validTickers.includes(t.toUpperCase().trim()))
  if (hallucinated.length > 0) {
    console.log(`[llm] dropped hallucinated tickers: ${hallucinated.join(', ')}`)
  }

  // Persist
  const analysis = await saveAnalysis({
    article_id:      article.id,
    summary,
    economic_impact: economicImpact,
    material,
    confidence,
    provider,
    raw_response:    raw as Record<string, unknown>,
    cost_tokens_in:  tokensIn,
    cost_tokens_out: tokensOut,
  })

  // Save one signal per valid ticker (primary gets the scored sentiment;
  // multi-ticker articles get a single sentiment — Phase 14 can refine this)
  if (validTickers.length > 0 || material) {
    for (let i = 0; i < validTickers.length; i++) {
      await saveSignal({
        analysis_id:     analysis.id,
        ticker_symbol:   validTickers[i],
        sentiment:       i === 0 ? sentiment : 'NEUTRAL',
        sentiment_score: i === 0 ? sentimentScore : 0,
      })
    }
  }

  console.log(
    `[llm] article=${article.id.slice(0, 8)} provider=${provider} ` +
    `tickers=${validTickers.join(',')||'none'} sentiment=${sentiment} score=${sentimentScore}`
  )
}
