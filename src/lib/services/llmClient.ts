import { REPAIR_PROMPT, RESPONSE_SCHEMA } from '@/lib/prompts/briefPrompt'
import type { ModelEntry } from '@/lib/services/modelRegistry'

/**
 * Generic LLM caller for `vercel`-runner models.
 *
 * Generalizes the provider/fallback pattern from Stein 1.0's llmService, with
 * one behavioural fix: a non-429/5xx error no longer throws out of the call and
 * abort everything. It returns null so the caller can try the next model —
 * in 1.0 a single 400 killed an entire batch.
 */

export type LLMResult = {
  text: string
  tokensIn: number
  tokensOut: number
  model: string
}

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'

// Brief generation is a single large call; give it room.
const REQUEST_TIMEOUT_MS = 240_000

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

async function callGemini(model: ModelEntry, prompt: string): Promise<LLMResult | null> {
  const key = process.env.GEMINI_API_KEY
  if (!key) {
    console.warn('[llm] GEMINI_API_KEY not set, skipping', model.id)
    return null
  }

  try {
    const res = await postJson(
      `${GEMINI_BASE}/${model.wireName}:generateContent`,
      {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
          maxOutputTokens: 16384,
        },
      },
      // Key in a header rather than the query string so it cannot leak
      // into request logs or error messages (1.0 put it in the URL).
      { 'x-goog-api-key': key }
    )

    if (!res.ok) {
      const body = await res.text()
      console.warn(`[llm] ${model.id} HTTP ${res.status}: ${body.slice(0, 200)}`)
      return null
    }

    const json = await res.json()
    const text: string = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    if (!text) {
      console.warn(`[llm] ${model.id} returned no text`)
      return null
    }
    return {
      text,
      tokensIn: json?.usageMetadata?.promptTokenCount ?? 0,
      tokensOut: json?.usageMetadata?.candidatesTokenCount ?? 0,
      model: model.wireName,
    }
  } catch (err) {
    console.warn(`[llm] ${model.id} failed:`, (err as Error).message)
    return null
  }
}

async function callGroq(model: ModelEntry, prompt: string): Promise<LLMResult | null> {
  const key = process.env.GROQ_API_KEY
  if (!key) {
    console.warn('[llm] GROQ_API_KEY not set, skipping', model.id)
    return null
  }

  try {
    const res = await postJson(
      GROQ_URL,
      {
        model: model.wireName,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        response_format: { type: 'json_object' },
      },
      { Authorization: `Bearer ${key}` }
    )

    if (!res.ok) {
      const body = await res.text()
      console.warn(`[llm] ${model.id} HTTP ${res.status}: ${body.slice(0, 200)}`)
      return null
    }

    const json = await res.json()
    const text: string = json?.choices?.[0]?.message?.content ?? ''
    if (!text) return null
    return {
      text,
      tokensIn: json?.usage?.prompt_tokens ?? 0,
      tokensOut: json?.usage?.completion_tokens ?? 0,
      model: model.wireName,
    }
  } catch (err) {
    console.warn(`[llm] ${model.id} failed:`, (err as Error).message)
    return null
  }
}

/** Call one `vercel`-runner model. Returns null on any failure — never throws. */
export async function callModel(model: ModelEntry, prompt: string): Promise<LLMResult | null> {
  if (model.runner !== 'vercel') {
    throw new Error(`callModel cannot run '${model.runner}' model ${model.id}`)
  }
  if (model.provider === 'gemini') return callGemini(model, prompt)
  if (model.provider === 'groq') return callGroq(model, prompt)
  throw new Error(`No vercel transport for provider ${model.provider}`)
}

/** Strips markdown fences some models add despite instructions. */
export function stripFences(text: string): string {
  const trimmed = text.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed)
  return fenced ? fenced[1].trim() : trimmed
}

export function parseJson<T = Record<string, unknown>>(text: string): T | null {
  try {
    return JSON.parse(stripFences(text)) as T
  } catch {
    return null
  }
}

/**
 * Calls a model and parses its JSON, retrying once with a repair prompt.
 * The repair retry sends the full original prompt (1.0 sent only the first 500
 * characters, which silently re-analyzed a truncated input).
 */
export async function callModelForJson<T = Record<string, unknown>>(
  model: ModelEntry,
  prompt: string
): Promise<{ parsed: T; raw: LLMResult } | null> {
  const first = await callModel(model, prompt)
  if (!first) return null

  const parsed = parseJson<T>(first.text)
  if (parsed) return { parsed, raw: first }

  console.warn(`[llm] ${model.id} returned unparseable JSON, attempting repair`)
  const repair = await callModel(model, `${prompt}\n\n${REPAIR_PROMPT}`)
  if (!repair) return null

  const reparsed = parseJson<T>(repair.text)
  if (!reparsed) {
    console.warn(`[llm] ${model.id} repair also failed`)
    return null
  }

  return {
    parsed: reparsed,
    raw: {
      ...repair,
      tokensIn: first.tokensIn + repair.tokensIn,
      tokensOut: first.tokensOut + repair.tokensOut,
    },
  }
}
