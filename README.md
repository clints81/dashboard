# morning-briefing-retrieval

The morning briefing, rebuilt as a scheduled Cloudflare Worker
(`briefing-retrieval.clintsievers.workers.dev`). Phase 1 pulls news from
structured feeds and APIs into dated candidate pools in KV. Phase 2 sends
the pools and the story log to the Claude API, verifies what comes back,
and publishes the briefing to the dashboard. Why things are built this
way: [DESIGN.md](DESIGN.md).

It is separate from the dashboard Worker (`briefing.clintsievers.workers.dev`,
source in `clints81/dashboard/worker.js`) and uses its own KV namespace
(`briefing-pool`, not `briefing-store`). Nothing here can break the dashboard.

## Pools

| Key | What |
|---|---|
| `news:YYYY-MM-DD` | Items published in the last 36h from NYT (Top Stories API: home, world, us, politics, business, technology, science; HomePage RSS backstop), WSJ (world, US, business, tech, economy), Guardian API, NPR, BBC, Politico, Ars Technica |
| `sitwith:YYYY-MM-DD` | Rolling 7 days (RSS) from NYT Magazine/Sunday Review, The Athletic, The Atlantic, Arts & Letters Daily, Wired, The Dispatch, The New Yorker, Foreign Affairs, Guardian Long Read, Comment, Christianity Today, New York, Noema, Aeon, Nautilus, WSJ (Arts & Culture, Lifestyle), The Washington Post (Style) |
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
| Counted article text | Foreign Affairs, Comment, Wired (its metadata says 1100 on every page), New York, Noema, Aeon, Nautilus |
| NYT Article Search, looked up by headline | NYT Magazine, Sunday Review (nytimes.com pages 403; the API can't filter by URL) |
| None | The Athletic (pages 403, not in Article Search), WSJ (401), The Washington Post (times out) |

Measured lengths are cached in `lengths` for 10 days, so each article is
fetched once. Misses retry on a later day (3 tries). Nothing is guessed: an
unmeasured item stays `null`. First full run (2026-10-04): 101 of 117
sit-with items measured.

## The briefing (phase 2)

After the pools are built, the next cron tick submits the briefing to the
Claude API as a batch (half price) and later ticks collect it. If it isn't
back by 09:30 UTC, it's cancelled and the request made directly. The
prompt is [src/briefing-prompt.md](src/briefing-prompt.md); the edition is
passed in:

- **Weekday:** 10–12 fresh stories, one or two lines each
- **Saturday, the week that was:** 5–7 threads from the week's briefings, plus 0–3 fresh stories
- **Sunday, the week ahead:** 5–7 things to watch, 0–3 fresh stories, and the Sunday long read

[src/judge.js](src/judge.js) verifies everything against the pool (see
DESIGN.md), picks each link (NYT when the Times has the story), and saves
`brief:<date>`. A second model (`COMPARE_MODEL`) runs in the same batch
for comparison at `/brief/<date>?ab`.

With `PUBLISH = "on"` in `wrangler.toml` it then:
- PUTs the dashboard JSON to the dashboard Worker (same shape Cowork sent)
- saves the day's fresh-story labels to `storylog` in KV (7 days, read for fatigue)
- appends the day's entry to the Notion story log, and on Sundays the long read to the deep-dive log

With `PUBLISH = "off"` (shadow mode, the default until Cowork is turned
off) nothing leaves the Worker; read the edition at `/brief`.

## Endpoints

```
GET  /                     latest summary (counts + failing sources)
GET  /brief[/YYYY-MM-DD]   the edition with sources, verification and cost (HTML; ?json; ?ab side by side)
GET  /cowork[/YYYY-MM-DD]  Cowork's briefing as snapshotted (feeds Saturday's recap before cutover)
GET  /compare[/YYYY-MM-DD] Cowork stories vs the pool (HTML; ?json for the card)
GET  /news[/YYYY-MM-DD]
GET  /sitwith[/YYYY-MM-DD]
GET  /status[/YYYY-MM-DD]  per-source results, no items
GET  /stats
POST /run                  X-Run-Key required; ?all=1 every pending source, ?force=1 restart today
POST /judge                X-Run-Key required; submit or collect today's batch. ?direct=1 full-price call now, ?force=1 start over, ?shadow=1 don't publish
```

## Comparison with the Cowork briefing

`/compare` matches each story in Cowork's briefing (read from the dashboard
Worker through a read-only service binding) against that day's pool by
headline words, showing the top 3 pool matches, a verdict (same link /
likely / check / not found), and whether Cowork's outlet is a pool source.
A search box covers every pool item. A 12:00 UTC cron saves each morning's
briefing as `cowork:<date>` so earlier days stay comparable;
`/compare?json` feeds the dashboard card.

## How a run works

Cron fires every 5 minutes from 06:00 to 09:55 UTC (1:00am CDT / midnight CST; the pool is usually ready ~40 minutes later, and the briefing usually within the hour after that). The free plan allows
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
npm run judge-dry-run                 # one edition from the live pool, locally, publishes nothing (~$0.30)
npm run judge-dry-run -- --both       # same, plus the comparison model
npx wrangler secret put NYT_API_KEY   # production keys; prompts, input hidden
npx wrangler secret put GUARDIAN_API_KEY
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put NOTION_TOKEN
npx wrangler secret put DASHBOARD_WRITE_KEY
npm run deploy
```

Keys: NYT from developer.nytimes.com (enable Top Stories),
Guardian from open-platform.theguardian.com, Anthropic from
platform.claude.com (API keys), Notion from notion.so/profile/integrations
(an internal integration connected to the story log and deep-dive log pages). The dashboard
write key is the one the Cowork task used (in 1Password).
