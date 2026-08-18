import { createServiceClient } from '@/lib/supabase/server'

/**
 * Setup verification.
 *
 * Every integration Stein depends on can fail in the same two boring ways: the
 * credential is missing, or the credential is present but wrong. Without this,
 * both surface as a 500 from some cron endpoint hours later. This checks each
 * one directly and says which of the two it is.
 *
 * Deliberately cheap: no LLM generation, no Flex statement request (that one is
 * opt-in via ?deep=1 because it can take ~45s), no email actually sent.
 */

export type CheckState = 'ok' | 'missing' | 'error' | 'skipped'

export type Check = {
  name: string
  state: CheckState
  detail: string
  /** What the owner should do about it. Empty when state is 'ok'. */
  fix?: string
  required: boolean
}

export type Preflight = {
  checked_at: string
  ready: boolean
  summary: { ok: number; missing: number; error: number; skipped: number }
  checks: Check[]
}

function env(name: string): string | null {
  const v = process.env[name]
  return v && v.trim() !== '' ? v : null
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)),
  ])
}

// ── Individual checks ────────────────────────────────────────────────────────

async function checkSupabase(): Promise<Check> {
  const base = { name: 'Supabase', required: true }
  if (!env('NEXT_PUBLIC_SUPABASE_URL') || !env('SUPABASE_SERVICE_ROLE_KEY')) {
    return {
      ...base,
      state: 'missing',
      detail: 'URL or service role key not set',
      fix: 'Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in Vercel.',
    }
  }
  try {
    const db = createServiceClient()
    // Query a 2.0 table: proves both connectivity and that migration 0004 ran.
    const { error } = await withTimeout(
      Promise.resolve(db.from('briefs').select('id', { head: true, count: 'exact' })),
      8000
    )
    if (error) {
      const missingTable = /relation .* does not exist|schema cache/i.test(error.message)
      return {
        ...base,
        state: 'error',
        detail: error.message,
        fix: missingTable
          ? 'Run supabase/migrations/0004_stein2_schema.sql in the Supabase SQL editor.'
          : 'Check the service role key is correct and the public schema is exposed under Data API.',
      }
    }
    return { ...base, state: 'ok', detail: 'Connected; 2.0 tables present.' }
  } catch (err) {
    return {
      ...base,
      state: 'error',
      detail: (err as Error).message,
      fix: 'Verify the Supabase project is running and the URL is correct.',
    }
  }
}

async function checkGemini(): Promise<Check> {
  const base = { name: 'Gemini (brief fallback)', required: true }
  const key = env('GEMINI_API_KEY')
  if (!key) {
    return {
      ...base,
      state: 'missing',
      detail: 'GEMINI_API_KEY not set',
      fix: 'Create a free key at aistudio.google.com and set GEMINI_API_KEY.',
    }
  }
  try {
    // Listing models validates the key without spending generation budget.
    const res = await withTimeout(
      fetch('https://generativelanguage.googleapis.com/v1beta/models', {
        headers: { 'x-goog-api-key': key },
      }),
      8000
    )
    if (!res.ok) {
      return {
        ...base,
        state: 'error',
        detail: `HTTP ${res.status}`,
        fix: 'The key was rejected. Regenerate it at aistudio.google.com.',
      }
    }
    return { ...base, state: 'ok', detail: 'Key accepted.' }
  } catch (err) {
    return { ...base, state: 'error', detail: (err as Error).message }
  }
}

async function checkResend(): Promise<Check> {
  const base = { name: 'Resend (email delivery)', required: true }
  const key = env('RESEND_API_KEY')
  const to = env('BRIEF_RECIPIENT_EMAIL')
  if (!key || !to) {
    return {
      ...base,
      state: 'missing',
      detail: !key ? 'RESEND_API_KEY not set' : 'BRIEF_RECIPIENT_EMAIL not set',
      fix: 'Create a free account at resend.com, then set RESEND_API_KEY and BRIEF_RECIPIENT_EMAIL.',
    }
  }
  try {
    // /domains is a free authenticated read — validates the key, sends nothing.
    const res = await withTimeout(
      fetch('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${key}` } }),
      8000
    )
    if (res.status === 401 || res.status === 403) {
      return { ...base, state: 'error', detail: 'Key rejected', fix: 'Regenerate the API key at resend.com.' }
    }
    if (!res.ok) return { ...base, state: 'error', detail: `HTTP ${res.status}` }
    return { ...base, state: 'ok', detail: `Key accepted; briefs will go to ${to}.` }
  } catch (err) {
    return { ...base, state: 'error', detail: (err as Error).message }
  }
}

async function checkYahoo(): Promise<Check> {
  const base = { name: 'Yahoo Finance (prices)', required: true }
  try {
    const res = await withTimeout(
      fetch('https://query2.finance.yahoo.com/v8/finance/chart/SPY?interval=1d&range=5d', {
        headers: { 'User-Agent': 'Mozilla/5.0 (ProjectStein preflight)' },
      }),
      8000
    )
    if (!res.ok) {
      return {
        ...base,
        state: 'error',
        detail: `HTTP ${res.status}`,
        fix: 'Yahoo may be rate-limiting. Usually transient — retry in a few minutes.',
      }
    }
    const json = await res.json()
    const close = json?.chart?.result?.[0]?.meta?.regularMarketPrice
    return {
      ...base,
      state: 'ok',
      detail: close ? `Reachable; SPY last ${close}.` : 'Reachable.',
    }
  } catch (err) {
    return { ...base, state: 'error', detail: (err as Error).message }
  }
}

async function checkFlex(deep: boolean): Promise<Check> {
  const base = { name: 'IBKR Flex (positions)', required: true }
  const token = env('IBKR_FLEX_TOKEN')
  const queryId = env('IBKR_FLEX_QUERY_ID')
  if (!token || !queryId) {
    return {
      ...base,
      state: 'missing',
      detail: !token ? 'IBKR_FLEX_TOKEN not set' : 'IBKR_FLEX_QUERY_ID not set',
      fix: 'Client Portal → Performance & Reports → Flex Queries (Open Positions, XML, Last Business Day) for the query id; Settings → Flex Web Service for the token.',
    }
  }
  if (!deep) {
    return {
      ...base,
      state: 'skipped',
      detail: 'Credentials present; live check skipped (it takes ~45s).',
      fix: 'Add ?deep=1 to run the real statement request.',
    }
  }
  try {
    const url = `https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest?t=${encodeURIComponent(token)}&q=${encodeURIComponent(queryId)}&v=3`
    const res = await withTimeout(
      fetch(url, { headers: { 'User-Agent': 'ProjectStein/2.0 (preflight)' } }),
      15000
    )
    const xml = await res.text()
    const errCode = /<ErrorCode>(\d+)<\/ErrorCode>/.exec(xml)?.[1]
    if (errCode) {
      const msg = /<ErrorMessage>([^<]*)<\/ErrorMessage>/.exec(xml)?.[1] ?? 'unknown'
      return {
        ...base,
        state: 'error',
        detail: `Flex error ${errCode}: ${msg}`,
        fix:
          errCode === '1012' || errCode === '1020'
            ? 'The token or query id is wrong, or the token has expired — regenerate both in Client Portal.'
            : 'Check the Flex Query includes the Open Positions section and is XML format.',
      }
    }
    const hasRef = /<ReferenceCode>/.test(xml)
    return {
      ...base,
      state: hasRef ? 'ok' : 'error',
      detail: hasRef ? 'Token and query id accepted.' : 'No reference code returned.',
    }
  } catch (err) {
    return { ...base, state: 'error', detail: (err as Error).message }
  }
}

async function checkGithubDispatch(): Promise<Check> {
  const base = { name: 'GitHub dispatch (Claude worker)', required: false }
  const token = env('GITHUB_DISPATCH_TOKEN')
  const repo = env('GITHUB_REPO')
  if (!token || !repo) {
    return {
      ...base,
      state: 'missing',
      detail: !token ? 'GITHUB_DISPATCH_TOKEN not set' : 'GITHUB_REPO not set',
      fix: 'Optional — only needed to run briefs on your Claude subscription. Fine-grained PAT with Actions: write, plus GITHUB_REPO=owner/repo.',
    }
  }
  try {
    const res = await withTimeout(
      fetch(`https://api.github.com/repos/${repo}/actions/workflows/brief-worker.yml`, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }),
      8000
    )
    if (res.status === 404) {
      return {
        ...base,
        state: 'error',
        detail: 'Workflow not found',
        fix: 'Push the branch containing .github/workflows/brief-worker.yml, and check GITHUB_REPO is owner/repo.',
      }
    }
    if (!res.ok) {
      return {
        ...base,
        state: 'error',
        detail: `HTTP ${res.status}`,
        fix: 'The PAT needs Actions: write on this repository.',
      }
    }
    const json = await res.json()
    const disabled = json?.state && json.state !== 'active'
    return {
      ...base,
      state: disabled ? 'error' : 'ok',
      detail: disabled ? `Workflow state: ${json.state}` : 'Token accepted; worker workflow is active.',
      fix: disabled ? 'Enable the workflow in the GitHub Actions tab.' : undefined,
    }
  } catch (err) {
    return { ...base, state: 'error', detail: (err as Error).message }
  }
}

function checkPush(): Check {
  const base = { name: 'Web Push (notifications)', required: false }
  const pub = env('NEXT_PUBLIC_VAPID_PUBLIC_KEY')
  const priv = env('VAPID_PRIVATE_KEY')
  const subject = env('VAPID_SUBJECT')
  if (!pub || !priv || !subject) {
    return {
      ...base,
      state: 'missing',
      detail: 'VAPID keys incomplete',
      fix: 'Optional — email works without it. Run `npx web-push generate-vapid-keys` and set the three VAPID vars.',
    }
  }
  return { ...base, state: 'ok', detail: 'VAPID keys present.' }
}

function checkCronSecret(): Check {
  const base = { name: 'Cron secret', required: true }
  const secret = env('CRON_SECRET')
  if (!secret) {
    return {
      ...base,
      state: 'missing',
      detail: 'CRON_SECRET not set',
      fix: 'Generate with `openssl rand -hex 32` and set it in BOTH Vercel and GitHub Actions secrets.',
    }
  }
  if (secret.length < 16) {
    return {
      ...base,
      state: 'error',
      detail: 'Suspiciously short',
      fix: 'Use `openssl rand -hex 32`.',
    }
  }
  return { ...base, state: 'ok', detail: 'Set.' }
}

// ── Entry point ──────────────────────────────────────────────────────────────

export async function runPreflight(deep = false): Promise<Preflight> {
  const checks = await Promise.all([
    checkSupabase(),
    Promise.resolve(checkCronSecret()),
    checkGemini(),
    checkFlex(deep),
    checkResend(),
    checkYahoo(),
    checkGithubDispatch(),
    Promise.resolve(checkPush()),
  ])

  const summary = { ok: 0, missing: 0, error: 0, skipped: 0 }
  for (const c of checks) summary[c.state]++

  // 'skipped' counts as ready — the credentials are present, only the slow
  // live call was deferred.
  const ready = checks.every((c) => !c.required || c.state === 'ok' || c.state === 'skipped')

  return { checked_at: new Date().toISOString(), ready, summary, checks }
}
