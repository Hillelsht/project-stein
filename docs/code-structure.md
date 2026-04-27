# Project Stein — Code Structure

## Folder layout

```
project-stein/
├── src/
│   ├── app/                        # Next.js App Router pages and API routes
│   │   ├── layout.tsx
│   │   ├── page.tsx                # Signal feed (main page)
│   │   ├── watchlist/page.tsx      # Manage tickers (Phase 9)
│   │   ├── stats/page.tsx          # Validation dashboard (Phase 12)
│   │   └── api/
│   │       ├── cron/
│   │       │   ├── ingest/route.ts         # Fetches RSS feeds
│   │       │   ├── analyze/route.ts        # Runs filter + LLM pipeline
│   │       │   ├── validate/route.ts       # Fills signal_outcomes
│   │       │   ├── refresh-tickers/route.ts
│   │       │   └── dedup-cleanup/route.ts
│   │       ├── stats/route.ts              # Returns validation stats JSON
│   │       ├── push/subscribe/route.ts     # Saves push subscription
│   │       └── health/route.ts             # Ops health check
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts           # Browser client (anon key)
│   │   │   └── server.ts           # Server clients: createServerClient (session) + createServiceClient (service role)
│   │   ├── repositories/           # ALL Supabase access lives here — nowhere else
│   │   │   ├── sourceRepo.ts
│   │   │   ├── articleRepo.ts
│   │   │   ├── analysisRepo.ts
│   │   │   ├── signalRepo.ts
│   │   │   ├── watchlistRepo.ts
│   │   │   ├── outcomeRepo.ts
│   │   │   ├── tickerMasterRepo.ts
│   │   │   ├── dedupRepo.ts
│   │   │   └── pushRepo.ts
│   │   ├── services/               # Business logic — calls repos, never Supabase directly
│   │   │   ├── rssService.ts       # Fetches and stores RSS items (Phase 3)
│   │   │   ├── filterService.ts    # Pre-LLM filter pipeline (Phase 5)
│   │   │   ├── llmService.ts       # Gemini + Groq calls (Phase 6)
│   │   │   ├── priceService.ts     # yahoo-finance2 price fetching (Phase 8)
│   │   │   ├── validationService.ts # Fills signal_outcomes, computes stats (Phase 8)
│   │   │   ├── tickerMasterService.ts # NASDAQ Trader CSV refresh (Phase 4)
│   │   │   └── pushService.ts      # Web Push sending (Phase 11)
│   │   └── prompts/
│   │       └── sentimentPrompt.ts  # LLM system prompt (Phase 6)
│   └── components/                 # React components (Phase 10+)
│       ├── SignalCard.tsx
│       ├── FeedToggle.tsx
│       └── LegalFooter.tsx
├── supabase/
│   └── migrations/
│       └── 0001_initial_schema.sql
├── public/
│   ├── manifest.json               # PWA manifest (Phase 11)
│   └── sw.js                       # Service worker (Phase 11)
├── .github/
│   └── workflows/
│       └── cron.yml                # GitHub Actions cron (Phase 7)
├── docs/                           # This folder — living documentation
└── .env.local                      # Never committed; see .env.example
```

## Hard rules

1. **No Supabase calls outside `src/lib/repositories/`.**
   Services call repos. API routes call services or repos. Never `createClient()` in a service file.

2. **No React/Next.js imports in `src/lib/`.**
   The entire `lib/` folder is framework-agnostic. Pure TypeScript.

3. **`createServiceClient()` is backend-only.**
   It holds the service role key. Never expose it to browser code (never in a client component or any file that imports `'use client'`).

4. **`SUPABASE_SERVICE_ROLE_KEY` is never `NEXT_PUBLIC_`.**
   All env vars without `NEXT_PUBLIC_` prefix are server-side only.

5. **All cron routes require `Authorization: Bearer ${CRON_SECRET}` header.**
   Return 401 otherwise. GitHub Actions provides this header.

## Key type conventions

- All repo files export their own plain TypeScript types (not Supabase auto-generated types).
- `NewX` types are insert payloads (no `id`, no `created_at`).
- `X` types are full DB rows.
- Timestamps are `string` (ISO 8601) — Supabase returns them as strings over the API.

## Cron schedule (GitHub Actions)

| Schedule | What runs |
|---|---|
| Every 10 min, Mon–Fri 14:30–21:00 UTC (market hours) | ingest + analyze |
| Every 30 min otherwise | ingest + analyze |
| Every 2 hr overnight + weekends | ingest + analyze |
| Daily 02:00 UTC | validate |
| Daily 03:00 UTC | dedup-cleanup |
| Sundays 04:00 UTC | refresh-tickers |

## Environment variables

See `.env.example` for the full list. Key ones:

| Variable | Used by |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Both browser and server clients |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser client, session server client |
| `SUPABASE_SERVICE_ROLE_KEY` | `createServiceClient()` only — bypasses RLS |
| `GEMINI_API_KEY` | llmService |
| `GROQ_API_KEY` | llmService (fallback) |
| `CRON_SECRET` | All `/api/cron/*` routes + GitHub Actions secret |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Browser push subscription |
| `VAPID_PRIVATE_KEY` | pushService (server-side signing) |
| `SEC_USER_AGENT` | rssService — SEC requires contact info in UA header |
