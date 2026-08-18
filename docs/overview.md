# Project Stein — Overview

## What it is

A private, portfolio-aware trading brief. Twice each trading day it reads the
owner's actual IBKR positions, computes technicals, gathers filtered news and
the calendar, and asks a frontier model one question: **what should I open or
close today?**

Every trade idea it produces is written to a ledger with an entry price, an
invalidation level, and a horizon — then priced nightly against SPY. The
scoreboard is the point: it answers "has any of this actually worked?" with a
number rather than a feeling.

## What it is NOT

- Not a signal feed. Stein 1.0 was, and it was not useful — see below.
- Not a tool to beat HFT firms. Free EOD data is minutes-to-hours behind.
- Not licensed financial advice.
- Not an auto-trader. It reads the broker; it never sends an order.

## Why 2.0 exists

Stein 1.0 scored individual news articles with ~800 small LLM calls a day and
showed the results as a feed. It failed for five reasons, all structural:

1. **Per-article sentiment scores are not decisions.** "BMY · NEUTRAL · 2/10"
   tells you nothing about what to do.
2. **Tiny calls on truncated text produce shallow output.** Multi-ticker
   articles only ever scored their first ticker.
3. **Magic-link auth** made every visit a chore.
4. **It never knew what the owner owned** — no positions, no P&L, no risk.
5. **It died silently.** GitHub disables scheduled workflows after 60 days of
   repo inactivity; the cron stopped and nothing ingested for months.

2.0 inverts the pipeline: **few large LLM calls with rich context** instead of
many small ones with none, delivered to the owner instead of waiting to be
visited, and held accountable by a scoreboard.

## Tech stack

| Layer | Choice | Reason |
|---|---|---|
| Frontend + API | Next.js 16 (App Router) + TypeScript | Familiar; `src/proxy.ts` replaces middleware in v16 |
| Styling | Tailwind CSS v4 | Utility-first, dark-only |
| Database | Supabase (Postgres) free tier | Free, managed, auth included |
| Hosting | Vercel Hobby | Free, native Next.js |
| Cron | GitHub Actions | Free, minute-level; Vercel Hobby allows 1 cron/day |
| Brief models | Claude Opus 5 / Sonnet 5 (owner's subscription, via Actions), Gemini 2.5 Pro/Flash (free tier), Groq (fallback) | Frontier quality at zero marginal cost |
| Portfolio | IBKR Flex Web Service | Free, token-based, no gateway process |
| Price data | `yahoo-finance2` | Free, no API key |
| Email | Resend free tier | 100/day is 50× headroom |
| Push | Web Push API + service worker | Free, works in installed PWAs |

## Architecture

```
GitHub Actions (one job, one routing table)
  ├─ every 30 min (market hours)  → /api/cron/ingest  → RSS → articles
  │                                → /api/cron/select  → regex filter, NO LLM
  ├─ 10:30 & 21:00 UTC weekdays   → /api/cron/sync-positions → IBKR Flex
  ├─ 11:00 & 21:30 UTC weekdays   → /api/cron/brief    → the brief
  │     (+ 11:45 / 22:15 retry passes that also heal stranded briefs)
  ├─ 02:00 UTC Tue–Sat            → /api/cron/score    → price the ledger
  ├─ 03:00 UTC daily              → /api/cron/cleanup
  ├─ 04:00 UTC Sunday             → /api/cron/refresh-tickers
  └─ monthly                      → keepalive (beats the 60-day auto-disable)

Brief generation
  contextPackService  → positions + technicals + macro + news + open ideas
        │
        ├─ vercel runner  → Gemini/Groq REST, inline (~30–60s)
        └─ actions runner → brief-worker.yml runs `claude -p` on the
                            owner's subscription, POSTs the result back
        │
        ▼
  briefService.validateBrief  → drops anything unscoreable
        ▼
  briefs + recommendations (ledger)  →  email (Resend) + Web Push
```

## Success criteria

1. Runs unattended for 30 consecutive trading days.
2. After 60 days, the scoreboard can state **average alpha vs SPY** across
   closed recommendations — positive or negative, but a real number.
3. The owner reads the brief from email/push and rarely needs to open the site.
4. Monthly infrastructure cost stays at **$0**.
