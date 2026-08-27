# Project Stein — Code Structure

## Folder layout

```
project-stein/
├── src/
│   ├── proxy.ts                    # Next 16 route proxy (replaces middleware.ts).
│   │                               # Deny-by-default auth + legacy redirects.
│   ├── app/
│   │   ├── page.tsx                # Today's brief
│   │   ├── actions.ts              # signOut, runBriefNow, setDefaultModel
│   │   ├── (auth)/login/page.tsx   # Email + password
│   │   ├── briefs/                 # Archive + [id] detail
│   │   ├── scoreboard/page.tsx     # Alpha vs SPY, hit rate, full history
│   │   ├── portfolio/              # Positions, manual entry, watchlist, push
│   │   └── api/
│   │       ├── cron/
│   │       │   ├── ingest/         # RSS → articles
│   │       │   ├── select/         # regex filter, marks passed_filter (NO LLM)
│   │       │   ├── sync-positions/ # IBKR Flex
│   │       │   ├── brief/          # generate (?dry_run=1, ?type=, ?model=, ?heal=1)
│   │       │   ├── brief-pack/     # hands the Actions worker its prompt
│   │       │   ├── brief-result/   # receives the worker's output
│   │       │   ├── score/          # nightly ledger pricing
│   │       │   ├── cleanup/        # hashes, context packs, old articles
│   │       │   └── refresh-tickers/
│   │       ├── briefs/[id]/status/ # poll target for the Run Now panel
│   │       ├── push/{subscribe,unsubscribe}/
│   │       └── health/             # public, 200 ok / 503 degraded
│   ├── components/                 # Nav, BriefView, RunNowPanel, OpsBanner,
│   │                               # PushToggle, LegalFooter
│   └── lib/
│       ├── marketCalendar.ts       # NYSE trading days + holidays
│       ├── briefHtml.ts            # email template (pure string building)
│       ├── supabase/               # client.ts, server.ts
│       ├── repositories/           # ALL Supabase access lives here
│       │   ├── articleRepo.ts  sourceRepo.ts  dedupRepo.ts
│       │   ├── tickerMasterRepo.ts  watchlistRepo.ts  pushRepo.ts
│       │   ├── positionRepo.ts  briefRepo.ts
│       │   └── recommendationRepo.ts  settingsRepo.ts
│       ├── services/               # business logic — calls repos, never Supabase
│       │   ├── rssService.ts       filterService.ts    tickerMasterService.ts
│       │   ├── flexService.ts      marketDataService.ts contextPackService.ts
│       │   ├── modelRegistry.ts    llmClient.ts        briefService.ts
│       │   ├── dispatchService.ts  emailService.ts     pushService.ts
│       │   ├── scoringService.ts   opsService.ts
│       └── prompts/briefPrompt.ts
├── supabase/migrations/            # 0001 … 0004, applied by hand in the SQL editor
├── .github/workflows/
│   ├── cron.yml                    # one job, one routing table, + keepalive
│   └── brief-worker.yml            # runs `claude -p` on the owner's subscription
└── docs/                           # this folder — the project's operating system
```

## Hard rules

1. **No Supabase calls outside `src/lib/repositories/`.** Services call repos;
   routes call services. Never `createClient()` in a service.
2. **No React/Next imports in `src/lib/`.** The whole folder is plain TypeScript.
   (`briefHtml.ts` renders email as strings for exactly this reason.)
3. **`createServiceClient()` is server-only.** Never in a `'use client'` file.
4. **`SUPABASE_SERVICE_ROLE_KEY` is never `NEXT_PUBLIC_`.**
5. **Every `/api/cron/*` route checks `Authorization: Bearer ${CRON_SECRET}`** and
   returns 401 otherwise.
6. **LLM budget: ≤2 large brief calls per scheduled day** (plus on-demand runs the
   owner triggers). If a change would reintroduce per-article model calls, it is
   the wrong change — that is what 2.0 exists to undo.
7. **Never store a recommendation that cannot be scored.** Validation drops
   unknown tickers and wrong-side invalidations rather than persisting them.
8. **Update `docs/phases-log.md` at the end of every phase.**

## Conventions

- Repos export hand-written types: `X` is a full row, `NewX` an insert payload.
- Timestamps are ISO `string` (Supabase returns them that way).
- Server components + URL state by default. `RunNowPanel` is the only client
  component, because subscription-backed briefs complete asynchronously.
- Long-running routes export `maxDuration` (`brief` 300, `sync-positions` 60).

## Cron schedule (all UTC)

Routing lives in one `case` block in `cron.yml`; an unmapped schedule **fails the
run** rather than silently doing nothing.

| Cron | Endpoints |
|---|---|
| `*/30 11-22 * * 1-5` | ingest, select |
| `0 0-10,23 * * *` · `0 * * * 0,6` | ingest, select (off-hours, weekends) |
| `30 10 * * 1-5` · `0 21 * * 1-5` | sync-positions |
| `0 11 * * 1-5` · `45 11 * * 1-5` | brief (pre-market, then retry + heal) |
| `30 21 * * 1-5` · `15 22 * * 1-5` | brief (evening, then retry + heal) |
| `0 2 * * 2-6` | score |
| `0 3 * * *` | cleanup |
| `0 4 * * 0` | refresh-tickers |
| `0 5 1 * *` | keepalive (re-enables the workflow) |

DST is not tracked: schedules are fixed UTC, so brief times shift one hour
against ET in winter. Accepted deliberately — the evening slot still lands after
the close year-round.

## Environment variables

| Variable | Used by |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` | browser + session clients |
| `SUPABASE_SERVICE_ROLE_KEY` | `createServiceClient()` only |
| `CRON_SECRET` | every `/api/cron/*` + GitHub secret |
| `GEMINI_API_KEY` / `GROQ_API_KEY` | `llmClient` |
| `IBKR_FLEX_TOKEN` / `IBKR_FLEX_QUERY_ID` | `flexService` |
| `RESEND_API_KEY` / `BRIEF_RECIPIENT_EMAIL` / `BRIEF_FROM_EMAIL` | `emailService` |
| `GITHUB_DISPATCH_TOKEN` / `GITHUB_REPO` | `dispatchService` |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | push |
| `SEC_USER_AGENT` | `rssService` (SEC requires contact info) |
| `NEXT_PUBLIC_APP_URL` | email "Open Stein" link |

GitHub Actions secrets: `CRON_SECRET`, `APP_URL`, `CLAUDE_CODE_OAUTH_TOKEN`.
