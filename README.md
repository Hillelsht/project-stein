# Project Stein

A private, portfolio-aware trading brief. Twice each trading day it reads your
actual IBKR positions, computes technicals, gathers filtered news and the
calendar, and asks a frontier model **what to open or close today** — then emails
it to you.

Every idea it produces is logged with an entry price, an invalidation level, and
a horizon, and priced nightly against SPY. The scoreboard answers "has any of
this actually worked?" with a number.

Runs entirely on free tiers: Vercel Hobby, Supabase free, GitHub Actions, Resend
free, Gemini free tier, and your existing Claude subscription.

## Docs

Read in this order:

1. [`docs/overview.md`](docs/overview.md) — what it is and why 2.0 replaced 1.0
2. [`docs/phases-log.md`](docs/phases-log.md) — what was built, phase by phase
3. [`docs/code-structure.md`](docs/code-structure.md) — layout, hard rules, cron
4. [`docs/data-model.md`](docs/data-model.md) — every table
5. [`docs/pipeline.md`](docs/pipeline.md) — ingest → brief → ledger → scoreboard

## Local development

```bash
npm install
cp .env.example .env.local     # fill in the values below
npm run dev
```

## Environment variables

| Variable | Where | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` | Vercel | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel | Server-only. Never `NEXT_PUBLIC_`. |
| `CRON_SECRET` | Vercel + GitHub | `openssl rand -hex 32`; same value both places |
| `APP_URL` | GitHub secret | Deployment URL, no trailing slash |
| `GEMINI_API_KEY` | Vercel | aistudio.google.com, free tier |
| `GROQ_API_KEY` | Vercel | Optional last-resort fallback |
| `IBKR_FLEX_TOKEN` / `IBKR_FLEX_QUERY_ID` | Vercel | See setup below |
| `RESEND_API_KEY` / `BRIEF_RECIPIENT_EMAIL` | Vercel | resend.com, free tier |
| `BRIEF_FROM_EMAIL` | Vercel | Optional; defaults to `onboarding@resend.dev` |
| `GITHUB_DISPATCH_TOKEN` / `GITHUB_REPO` | Vercel | Fine-grained PAT, Actions: write |
| `CLAUDE_CODE_OAUTH_TOKEN` | GitHub secret | From `claude setup-token` |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Vercel | `npx web-push generate-vapid-keys` |
| `SEC_USER_AGENT` | Vercel | SEC requires contact info, e.g. `Stein/2.0 (you@email.com)` |
| `NEXT_PUBLIC_APP_URL` | Vercel | Used for the email's "Open Stein" link |

## One-time setup

1. **Supabase** — apply `supabase/migrations/0004_stein2_schema.sql` in the SQL
   editor. Set a password on your user (Authentication → Users), and confirm
   Authentication → Sessions has time-boxed sessions and inactivity timeout
   **off** so the login lasts.
2. **IBKR** — Client Portal → Performance & Reports → Flex Queries → create an
   Activity Flex Query with the *Open Positions* section, **XML** format, period
   *Last Business Day*. Note the query ID. Then Settings → Account Settings →
   Flex Web Service → generate a token.
3. **Resend** — create an account and an API key.
4. **Claude** (optional but recommended) — run `claude setup-token` locally and
   store the value as the `CLAUDE_CODE_OAUTH_TOKEN` GitHub secret. This is what
   lets briefs run on your Pro/Max subscription instead of a paid API key.
5. **GitHub** — Actions tab → enable the workflows (a repo that has been idle for
   60 days has them auto-disabled).

## Ops runbook

**Check health:** `GET /api/health` — public, `200` when ok, `503` when degraded,
with an `issues` array naming what is wrong. The same issues appear as an amber
banner inside the app.

**Preview what the model will see, without spending a call:**
```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "$APP_URL/api/cron/brief?dry_run=1" | jq '.pack.approx_tokens, .pack.counts'
```

**Force a brief:**
```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "$APP_URL/api/cron/brief?type=premarket&force=1"
```
Or press **Run now** in the app and pick a model.

**Rescue briefs stuck PENDING** (the Actions worker never reported back):
```bash
curl -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/cron/brief?heal=1"
```

**Re-enable the cron** if GitHub disabled it: Actions tab → "Project Stein Cron"
→ Enable. The monthly keepalive job prevents this going forward.

**Rotate the Flex token:** generate a new one in IBKR, update `IBKR_FLEX_TOKEN`
in Vercel, then verify:
```bash
curl -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/cron/sync-positions"
```

**Run any endpoint by hand:** Actions tab → "Project Stein Cron" → Run workflow →
set `endpoints` (e.g. `ingest select`, `score`, `cleanup`).

## Disclaimer

Automated research tooling, not licensed financial advice. Check the scoreboard
before acting on anything it produces.
