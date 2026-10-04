# morning-briefing-retrieval

Phase 1 of the morning briefing rebuild: a scheduled Cloudflare Worker
(`briefing-retrieval.clintsievers.workers.dev`) that pulls news from
structured feeds and APIs into dated candidate pools in KV. It does no
ranking or writing; the judgment step still lives in the Cowork task.

It is separate from the dashboard Worker (`briefing.clintsievers.workers.dev`,
source in `clints81/dashboard/worker.js`) and uses its own KV namespace
(`briefing-pool`, not `briefing-store`). Nothing here can break the dashboard.

## Pools

| Key | What |
|---|---|
| `news:YYYY-MM-DD` | Items published in the last 36h from NYT (Top Stories API: home, world, us, politics, business, technology, science; HomePage RSS backstop), Guardian API, NPR, BBC, Politico, Ars Technica |
| `sitwith:YYYY-MM-DD` | Rolling 7 days (RSS) from NYT Magazine/Sunday Review, The Athletic, The Atlantic, Arts & Letters Daily, Wired, The Dispatch, The New Yorker, Foreign Affairs, Guardian Long Read, Comment, Christianity Today |
| `stats` | Per-source status for each of the last 30 days, with ok/failed counts and consecutive failures |
| `run:YYYY-MM-DD` | The run in progress or finished: per-source status, counts, errors |

Dates are America/Chicago. Every item has a real `published_at`; items with
no parseable date are counted as `undated` in the source's status and dropped.
When two sources carry the same URL, NYT wins and the others are listed in
`also_in`.

`word_count` / `read_minutes` come from the feed when it carries full text
(The Atlantic, Ars, NPR, Politico) or the Guardian API. For other sit-with
items, spare cron ticks measure length per the source's `length` method
(`length_source` on each item says which):

| Method | Sources |
|---|---|
| Page metadata `wordCount`, else counted text | The Dispatch, Christianity Today, The New Yorker, Guardian Long Read, Arts & Letters Daily links |
| Counted article text | Foreign Affairs, Comment, Wired (its metadata says 1100 on every page) |
| NYT Article Search, looked up by headline | NYT Magazine, Sunday Review (nytimes.com pages 403; the API can't filter by URL) |
| None | The Athletic (pages 403, not in Article Search) |

Measured lengths are cached in `lengths` for 10 days, so each article is
fetched once. Misses retry on a later day (3 tries). Nothing is guessed: an
unmeasured item stays `null`. First full run (2026-10-04): 101 of 117
sit-with items measured.

## Endpoints

```
GET  /                     latest summary (counts + failing sources)
GET  /news[/YYYY-MM-DD]
GET  /sitwith[/YYYY-MM-DD]
GET  /status[/YYYY-MM-DD]  per-source results, no items
GET  /stats
POST /run                  X-Run-Key required; ?all=1 every pending source, ?force=1 restart today
```

## How a run works

Cron fires every 5 minutes from 06:00 to 07:55 UTC (1:00am CDT / midnight CST; the pool is usually ready ~40 minutes later). The free plan allows
~10ms CPU and 50 fetches per invocation, so each tick handles about four
sources (only one NYT call per tick, since NYT allows 5 calls/min), saves
progress in `run:<date>`, and the tick that finishes the last source builds
the pools. Failed sources retry on later ticks (3 attempts). Anything still
unfinished at 07:50 UTC is recorded as failed and the pools are built anyway.

Arts & Letters Daily's feed has no dates, so each new link's target page is
fetched for its own `datePublished`. Resolved dates are cached in
`aldaily:seen`, so after the first day only new links are fetched.

## Sources dropped after testing (2026-10-04)

The Ringer (no RSS; every feed URL 404s), Politico picks feed (403), Atlantic
magazine channel (404), New Yorker longreads tag (404), NYT Times Newswire
API (no longer offered to new apps).

## Setup

```bash
npm install
cp .dev.vars.example .dev.vars        # local keys, git-ignored
npm run dry-run                       # every source once, locally, no KV
npx wrangler secret put NYT_API_KEY   # production keys; prompts, input hidden
npx wrangler secret put GUARDIAN_API_KEY
npm run deploy
```

Keys: NYT from developer.nytimes.com (enable Top Stories),
Guardian from open-platform.theguardian.com.
