/**
 * Which models can write a brief, and how each one is reached.
 *
 * Two runners, because the owner's frontier-model access comes from
 * subscriptions rather than API keys:
 *
 *  - 'vercel'  — called directly from the brief route over REST. Instant, but
 *                limited to providers that hand out free API keys.
 *  - 'actions' — a GitHub Actions job runs Claude Code headlessly on the
 *                owner's Pro/Max subscription (`claude setup-token`), pulls the
 *                context pack from the app, and posts the result back. Slower
 *                (~2–3 min) but gives frontier-model quality at no marginal cost.
 */

export type ModelRunner = 'vercel' | 'actions'
export type ModelProvider = 'gemini' | 'groq' | 'claude'

export type ModelEntry = {
  id: string
  label: string
  provider: ModelProvider
  runner: ModelRunner
  /** Provider-specific model name sent on the wire. */
  wireName: string
  /** Groq's free tier cannot fit the full context pack. */
  requiresCompactPack?: boolean
  note?: string
}

export const MODELS: ModelEntry[] = [
  {
    id: 'claude-opus',
    label: 'Claude Opus 5',
    provider: 'claude',
    runner: 'actions',
    wireName: 'claude-opus-5',
    note: 'Highest quality. Runs on your Claude subscription via GitHub Actions (~2–3 min).',
  },
  {
    id: 'claude-sonnet',
    label: 'Claude Sonnet 5',
    provider: 'claude',
    runner: 'actions',
    wireName: 'claude-sonnet-5',
    note: 'Faster than Opus, still frontier-class. Runs on your Claude subscription.',
  },
  {
    id: 'gemini-pro',
    label: 'Gemini 2.5 Pro',
    provider: 'gemini',
    runner: 'vercel',
    wireName: 'gemini-2.5-pro',
    note: 'Generates immediately in the app. Free tier.',
  },
  {
    id: 'gemini-flash',
    label: 'Gemini 2.5 Flash',
    provider: 'gemini',
    runner: 'vercel',
    wireName: 'gemini-2.5-flash',
    note: 'Faster and higher free-tier limits than Pro.',
  },
  {
    id: 'groq-llama',
    label: 'Groq Llama 3.3 70B',
    provider: 'groq',
    runner: 'vercel',
    wireName: 'llama-3.3-70b-versatile',
    requiresCompactPack: true,
    note: 'Emergency fallback only — sees a trimmed context pack.',
  },
]

/** Used when the settings table has no `default_brief_model` row. */
export const DEFAULT_MODEL_ID = 'gemini-pro'

/**
 * Fallback order for the `vercel` runner. A scheduled brief walks this until
 * one model answers, so a provider outage never costs the owner a brief.
 */
export const VERCEL_FALLBACK_CHAIN = ['gemini-pro', 'gemini-flash', 'groq-llama']

export function getModel(id: string): ModelEntry | null {
  return MODELS.find((m) => m.id === id) ?? null
}

export function getModelOrDefault(id: string | null | undefined): ModelEntry {
  return (id ? getModel(id) : null) ?? getModel(DEFAULT_MODEL_ID)!
}

export function listModels(): ModelEntry[] {
  return MODELS
}
