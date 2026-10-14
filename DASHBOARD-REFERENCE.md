# Morning Dashboard — Architecture Reference

Last updated: October 14, 2026

## What this is
A personal morning dashboard for Clint Sievers, hosted on GitHub Pages. Plain HTML/CSS/JS — no framework, no build step. It exists to replace aimless scrolling with a purposeful briefing.

**Live URL:** `https://clints81.github.io/dashboard`
**Repository:** `github.com/clints81/dashboard`
**Worker:** `briefing.clintsievers.workers.dev` (deployed separately by pasting into the Cloudflare editor — but its source now lives in the repo as `worker.js`)
**Briefing Worker:** `briefing-retrieval.clintsievers.workers.dev` (source in `briefing-retrieval/`, deployed with `npm run deploy` from that folder)

Repo files:
- `index.html` — structure and design (edit rarely)
- `config.js` — personal data layer (edit regularly, no coding required)
- `app.js` — runtime logic and data fetching (edit for feature changes)
- `worker.js` — the Cloudflare Worker source (edit, commit, then paste into the Cloudflare editor and deploy)
- `briefing-retrieval/` — the Worker that writes the briefing overnight; its own `README.md` and `DESIGN.md` (see The briefing system)
- `DASHBOARD-REFERENCE.md` — this file

Everything in this repo is public and served by GitHub Pages. Secrets live in Cloudflare and 1Password, never here.

---

## The Worker

`briefing.clintsievers.workers.dev` is a Cloudflare Worker Clint owns. It is a single file that is deployed by pasting into the Cloudflare dashboard editor (not wrangler). The source now lives in the repo as **`worker.js`** — so the flow is: edit `worker.js`, commit, then paste the whole file into the Cloudflare editor and deploy. Git holds the history, so the old "keep a copy before editing" step is gone. **Never edit in the Cloudflare editor directly** — the deployed Worker and the repo would drift apart, and the next paste silently reverts the change.

It serves these routes:

| Route | Method | What it does |
|---|---|---|
| `/` | GET | Returns the latest briefing JSON from KV (`env.BRIEFING`, key `latest`). CORS `*`. |
| `/` | PUT | Writes briefing JSON to KV. Requires `X-Write-Key` header matching `env.WRITE_KEY`. Then records the sit-with pick in the archive; reports how that went in `X-Sitwith-Archive`. |
| `/sitwith` | GET | Past sit-with picks from the archive (KV key `sitwith-archive`). No key. CORS `*`. `no-store`. See The sit-with archive. |
| `/sports` | GET | Fetches, filters, and caches team/league news from RSS. CORS `*`. 20-min cache. |
| `/calendar` | GET | Parses ICS calendar feeds (`env.CAL_ICS_1` / `CAL_ICS_2`) for today's events. **Requires `X-Read-Key`.** CORS `*`. 5-min cache. |
| `/tasks` | GET | Queries the JELC treasurer Notion database (`env.NOTION_TOKEN`) for what's due and recently settled. **Requires `X-Read-Key`.** CORS `*`. 5-min cache. |
| `/devotion` | GET | Fetches the WELS Daily Devotions RSS feed and extracts verse, reference, title, excerpt. No secret. CORS `*`. 3-hr cache. |

The write key is `WRITE_KEY` in this Worker's Cloudflare settings, with copies in 1Password and as the `DASHBOARD_WRITE_KEY` secret on the `briefing-retrieval` Worker. It was rotated 2026-10-08, when it came out of the Cowork task text. Never in the repo. The other secrets (`CAL_ICS_1`, `NOTION_TOKEN`, `READ_KEY`) live in Cloudflare → Settings → Variables and Secrets, separate from the code editor.

Each route is one top-level name in `worker.js` (`handleSports`, `CALENDAR`, `TASKS`, `DEVOTION`, `SITWITH`) plus one line in the `fetch` router. Follow that convention when adding a route — it's what keeps per-route constants (each block has its own `CACHE_SECONDS`) from colliding.

### Read key
`/calendar` and `/tasks` return Clint's schedule and the church's payables, so they need a read key. Every other route stays public, `/sitwith` included: the picks aren't personal, and the computer bookmark should show them without a key.

Where the key lives:
- `READ_KEY` secret in this Worker's Cloudflare settings
- 1Password, item "Dashboard read key"
- Each device's browser storage (`localStorage["dashReadKey"]`), entered once per device on the card itself

Never in the repo. The page sends it as `X-Read-Key`.

How it behaves:
- **Worker.** `READ_GATE.check()` runs after OPTIONS (preflights never carry the key) and **before the cache lookup**, so a request without the key can never be served a cached copy. No key gets 401 `{"error":"locked","sources":{"auth":"missing"}}`, a wrong key gets `"rejected"`, and an unset `READ_KEY` fails closed with 500 `"READ_KEY unset"`. Refusals carry the CORS headers; without them the browser hides the status and "locked" looks like a network failure.
- **Caching.** The browser gets `cache-control: private, no-store`. The copy in `caches.default` keeps `public, max-age=300`, because `cache.put` refuses (413) a response whose Cache-Control says not to store it, and Cloudflare reads both `private` and `no-store` that way. `READ_GATE.forBrowser()` swaps the header on the way out.
- **Page.** With no key stored, the card shows "Locked on this device · Enter key" and doesn't fetch. If the Worker answers 401, the card shows "Key rejected · Re-enter key". `fetchRetry` doesn't retry a 401. Any other failure keeps the card's normal "… unavailable" line. Saving a key reloads only these two cards.

To rotate: set a new `READ_KEY` in Cloudflare, update 1Password, then re-enter the key on each device. Devices show "Key rejected" until you do.

### Why a Worker exists at all
The dashboard is served from `clints81.github.io`. Browsers refuse to let a page read a response from another origin unless that origin sends CORS headers saying it's allowed. Notion doesn't. `nytimes.com` doesn't. Server-side fetches aren't subject to that rule, so the Worker fetches on the dashboard's behalf and re-serves the result with `access-control-allow-origin: *`.

History: while the briefing ran in Cowork, GitHub was ruled out as the delivery route because `git push` and GitHub API writes were blocked from Cowork's cloud sandbox. That's why the briefing lands in this Worker's KV rather than in the repo.

---

## Data sources

### Live (fetched on page load, and again on foreground/reconnect)
- **Weather** — Open-Meteo (`api.open-meteo.com`), free, no key, CORS-safe. Lat/lon in `config.js`. Hourly + 5-day.
- **Sports** — Worker `/sports` route. See below.
- **On This Day** — Wikipedia `/feed/onthisday/events/{month}/{day}`. 3 events, seeded daily random, each clamped to 3 lines.
- **Briefing** — Worker root route. Written overnight by the `briefing-retrieval` Worker. See The briefing system.
- **Sit-with archive** — Worker `/sitwith` route. Past picks for the "Earlier this week" strip and the Sunday "Last week's reads" card. See The sit-with archive.
- **Calendar** — Worker `/calendar` route. Today's events from Google/iCloud ICS feeds. See below.
- **Treasurer tasks** — Worker `/tasks` route. JELC tasks from Notion. See below.
- **Daily devotion** — Worker `/devotion` route. WELS Daily Devotions RSS. See below.

All of these go through `fetchRetry()` in `app.js`: one retry after 2.5s, and a non-200 is treated as failure rather than parsed as JSON. The thrown error carries `.status`. A 401 is not retried, so the key-protected cards can tell "locked" from "broken".

### Static (config.js)
- Fallback "something to sit with" (shown only if the briefing fetch fails)
- Orangetheory subreddit name
- Sports cap (`maxItems`)

---

## The sports route

### Feeds
The Athletic publishes public RSS under `nytimes.com/athletic/rss/`. League-level only — per-team feed URLs do **not** exist (tested).

```
/athletic/rss/mlb              → cubs
/athletic/rss/nfl              → lions
/athletic/rss/nhl              → red-wings
/athletic/rss/football         → tottenham     ← "football", not "soccer"
/athletic/rss/college-football → (league fill only)
```

Northwestern comes from a Google News RSS search, because The Athletic barely covers them.

Each feed returns ~100 items.

### Matching strategy
**Match the slug, not the title or description.** An Athletic URL like `/athletic/7555999/2026/09/01/tottenham-transfer-deadline-signing/` names what the story is *about*. Titles and descriptions merely *mention* things — "Arsenal's window graded & what it means for Spurs" is an Arsenal story. Slug matching is the entire reason this card is precise.

Title matching is enabled **only** for Google News, whose links are redirect URLs with no usable slug.

Other filters:
- `/live-blogs/` URLs excluded — rolling posts that never resolve and mention every club in the league
- Freshness: 36h for team items, 24h for league fill, via `pubDate`
- Per-source caps: 3 per Athletic team, **2 for Northwestern**

The Northwestern cap is lower on purpose. Athletic feeds are self-limiting — there are only so many Cubs stories a day. A search query is not: Google returns 100 hits every time, mostly `nusports.com` press releases. Without the cap, one source fills the whole card.

### Diagnostics
The `/sports` JSON includes a `sources` block reporting each feed's status (`ok`, `empty`, `HTTP 503`, or an error). **Check this first when a team goes missing** — without it, a blocked fetch and a genuinely quiet day look identical.

### Cache
20 minutes, keyed on path + query string. `?/sports?t=N` with a changing N forces a fresh build. Don't hammer it — rapid rebuilds have triggered Google News 503s.

### Display
`app.js` takes `teams` first, then fills remaining slots from `league` — at most `CONFIG.sports.maxLeague` (3) of them — then caps at `CONFIG.sports.maxItems` (6). League filler renders headline-only; team items keep their description. Empty state reads "Nothing on your teams today."

The filler cap and headline-only treatment exist for layout as much as taste (Oct 2026): at six full items this card ran ~770px and pushed the rail ~600px past the briefing, leaving a dead column on the left.

**The cap is the point.** A card that ends is different in kind from a feed. Raising it turns this back into the thing it was built to replace.

Scores are deliberately not shown. ESPN and The Athletic do that better, and scores weren't the reason for opening an app.

---

## The calendar route

`/calendar` fetches ICS feeds (`env.CAL_ICS_1` = Google's secret iCal URL; `env.CAL_ICS_2` = an iCloud slot, wired and currently **unset**) and returns today's events. The browser can't do this itself — it can neither hold the secret URL nor fetch `calendar.google.com` cross-origin.

Load-bearing details, learned the hard way:
- **Times are wall-clock in `America/Chicago`, not UTC.** The block converts a zoned time to a UTC instant by guessing, measuring the error, and correcting (two passes settles DST boundaries). This is why a 9am standing meeting stays 9am after the November clock change.
- **All-day events keep their raw `YYYYMMDD` date string.** Round-tripping them through a UTC instant is how all-day events end up on the wrong day. The date is the fact, not the timestamp.
- **ICS lines fold** at 75 octets (a continuation line starts with space/tab); unfold before parsing or long titles arrive truncated.
- The `sources` block reports each feed as `ok (N in file, M today)`, `unset`, `HTTP nnn`, `not-ics`, or `error: …` — same rule as `/sports`: a blocked feed and a genuinely empty day must not produce identical JSON.
- `?date=YYYY-MM-DD` points the route at another day, for verifying parsing without waiting for a morning.
- Key-protected: send `X-Read-Key` (see Read key).

## The tasks route

`/tasks` queries the JELC treasurer Notion database and returns two lists — what's **due** and what was **recently settled**. `app.js` renders it as the Treasurer tasks card.

### Notion API facts — verified 2026-09-03, do not substitute from memory
- The 2025-09-03 API moved database queries onto **`/v1/data_sources/{id}/query`** (was `/databases/{id}/query`). The id used here is the **data source** id (`1a0f8d21-7e64-8041-96ed-000b1d9f7f86`), which is **not** the id in the Notion URL. Header `Notion-Version: 2025-09-03`, auth `Bearer ${env.NOTION_TOKEN}`.
- A **404 almost always means the integration wasn't granted access** to the database (fix in Notion → database → ••• → Connections), not a bad id. Notion reports missing permission as a missing object.
- **`Completion Date` is empty on every row** — it was meant to auto-fill and doesn't. Building "recently settled" on it produces a permanently empty section that looks like a quiet week. So "settled" = *due in the last 7 days and now `Paid`/`Complete`.*
- **`Days Left`, `Priority`, `Due In`, `Archive?`, `Auto Due Date` are Notion formulas** and aren't exposed to the query layer. `daysUntil` is computed in the Worker from `Due Date` (in `America/Chicago`).

### The two queries
- **Due** — `Due Date on_or_before today+7`, `Status ≠ Paid`, `Status ≠ Complete`, ascending. There is **deliberately no lower date bound** — that's what lets overdue items through (a January task still Open must surface, not hide).
- **Settled** — `Due Date` between `today−7` and `today`, `Status = Paid or Complete`, descending. A task paid late drops off, which is a visible failure rather than a silent one.

### The rest
- **Key-protected (since 2026-10-14).** Requires `X-Read-Key`; see Read key. This replaces the 2026-09-03 decision to leave the route open. That reasoning held that a client-sent key couldn't be real security on a public page, because any key would have to sit in the public JS. A key entered on each device and kept in its browser storage never appears in the page source, so that objection no longer applies. CORS stays `*`: the key is the lock, not the origin. To debug with curl, send the header: `curl -H "X-Read-Key: …" …/tasks`.
- The `sources.notion` block is required: `ok (N rows)`, `HTTP 401` (bad/missing token), `HTTP 404` (integration lacks access), or `error: …`. `loadTasks()` fails loudly to an "unavailable" state when it isn't `ok`, so an expired token never reads as a clear week.
- 5-min cache keyed on the full URL; `?t=N` or `?date=YYYY-MM-DD` force a rebuild / test another day.

---

## The devotion route

`/devotion` fetches the official **WELS Daily Devotions** RSS feed (`wels.net/dev-daily/feed/pt-dev-daily`) server-side — the browser can't read `wels.net` cross-origin — and returns the day's verse, scripture reference, devotion title, and a short excerpt, plus a read link (the item page) and a listen link (the mp3 enclosure). No key or secret; it's a public feed. This is the "sourced, not random" answer to wanting a daily verse: it's official WELS material, curated daily.

Each feed item follows a fixed template, which is what makes extraction reliable:
- **First paragraph is the scripture** — verse text, then the reference on its own line (a `<br>`). The parser takes the first non-boilerplate paragraph as the verse and pulls the reference off the last line (falling back to a reference regex). Verified against all 14 items in the feed at build time — refs include ranges (`Matthew 16:21-25`) and multi-verse (`Romans 8:19,22`).
- **The next paragraph is the reflection**; the excerpt is its first ~2 sentences (capped ~240 chars).
- **Boilerplate is skipped** — "Listen to Devotion", the WELS attribution, the Creative Commons line, and the NIV copyright line are filtered by prefix.
- Title comes from the item `<title>` ("Saved In Hope – September 3, 2026") split on the dash; audio from the `<enclosure>` url.
- `sources.wels` is `ok`, `parse-miss` (fetched but no verse found), `no-items`, `HTTP nnn`, or `error: …`. `loadDevotion()` fails to an "unavailable" state when it isn't `ok`.
- 3-hour cache (devotions update once a day, ~05:30 UTC); `?t=N` forces a rebuild.

If the WELS template ever changes and the verse stops parsing, `sources.wels` reports `parse-miss` rather than showing a blank card. Sibling feeds exist if a different flavor is ever wanted: `/bible3/feed/bible3` (Through My Bible in Three Years — a reading plan), plus family/women's/teen devotion feeds, all listed at `wels.net/rss-feeds`.

---

## The sit-with archive

Added 2026-10-14. The sit-with card used to show one pick and forget it. The archive keeps them, so the week's reads stay reachable.

### Storage
KV key `sitwith-archive` in `env.BRIEFING` (the same namespace as `latest`). A JSON array of `{date, day, type, headline, desc, source, read_time, url}`, newest first, one entry per date, capped at 60. A re-run on the same date replaces that date's entry. A failed night's briefing carries no pick, so it never erases one already recorded.

**Why the dashboard keeps its own copy** instead of reading `briefing-retrieval`'s stored briefs: those expire after 45 days, and this Worker can't call retrieval by URL on the same account (Cloudflare error 1042). The service binding only runs retrieval → dashboard.

### How it's written
The PUT to `/` writes `latest` first, then records **both** the previous `latest` and the incoming body. Recording the previous one means a failed archive write is caught up the next morning, when yesterday's briefing is the previous `latest`.

The archive must never fail the briefing write. Every archive step is guarded, the PUT still returns `OK`, and the outcome goes in a response header, `X-Sitwith-Archive: ok | error: <msg>`. An archive that isn't a JSON array is reported (`error: archive unreadable, not overwritten`) and left alone so it can be inspected. To reset it, delete the `sitwith-archive` key in the KV namespace. The next two mornings rebuild it.

### `GET /sitwith`
Returns `{items, sources, generated}`. Public, CORS `*`, `cache-control: no-store`.
- `items` merges three lists, lowest to highest precedence: `SEED`, the archive, the current `latest`. So `items[0]` is always the pick shown in the hero card.
- `?days=N` keeps picks dated within the last N days (Chicago), today included. The page asks for 14.
- `sources.archive`: `ok (N)`, `unreadable`, or `error: …`. `sources.latest`: `ok` or `no pick`.

`SEED` holds the picks from Oct 8–13, 2026, copied from retrieval's `/brief/<date>?json` (the `sit_with` block it sent to the dashboard), so the strip wasn't empty on its first week. Delete it after Oct 21, 2026 (in the Backlog).

### On the page
- **Mon–Sat** (Chicago date): an "Earlier this week" strip at the foot of the sit-with card, under a thin divider. It lists the six days before the hero's date, newest first, in two columns reading down the left, then the right. Each line shows the short weekday, the headline (one line, ellipsis) and the source, and links to the piece. The strip is hidden when there are no earlier picks. If this morning has no pick (the hero shows its placeholder), it counts back from today instead.
- **Sunday:** no strip. A full-width "Last week's reads" card sits below the sit-with card, above the band, covering the seven days before today, Sunday through Saturday. Each entry shows weekday + type, the headline in the serif face, the description, and source · read time. The badge reads "N pieces".
- If `sources.archive` isn't `ok`, or the fetch fails, the strip (or the Sunday card) says **"Archive unavailable"**. It's never hidden, so a broken archive can't look like a quiet week.
- Upstream text can arrive entity-encoded (`&#39;`). The page decodes it, then escapes it. The hero card decodes too.
- `renderSitArchive(data, 'YYYY-MM-DD')` is split from the fetch, so the Sunday card can be checked on any day from the console.

---

## The briefing system

Since 2026-10-08 the briefing is written by a separate Cloudflare Worker, **`briefing-retrieval`** (source in `briefing-retrieval/` in this repo, moved here 2026-10-14 from `clints81/morning-briefing-retrieval`; the reasoning behind it is in `briefing-retrieval/DESIGN.md`). It replaced the Cowork briefing and deep-dive tasks, which had stopped running reliably.

Each night, Central time:
1. From 1am (midnight in winter), it builds a candidate pool from feeds and APIs: NYT, WSJ, Guardian, BBC, NPR, Politico and Ars Technica for news; long-form outlets for the sit-with pick.
2. When the pool is ready, usually around 2:30am, it sends the pool and the story log to the Claude API as a batch at half price. Results are usually back within minutes. If not by 4:30am (3:30 in winter), it makes the call directly.
3. It checks every pick against the pool, prefers NYT links, then PUTs the JSON to this dashboard's Worker (`/`, `X-Write-Key`) and logs the day's stories.

Editions:
- **Weekday:** 10–12 stories, a line or two each, plus a one- or two-sentence synthesis.
- **Saturday, "the week that was":** threads from the week (`Week · …`), plus up to 3 new stories (`New · …`).
- **Sunday, "the week ahead":** things to watch (`Ahead · …`, timing first), up to 3 new stories, and the Sunday long read in the sit-with card.

`· floor` on a category marks a Technology, Science or Religion story included to meet the one-of-each floor rather than on merit. A short night is published with "Partial edition: …" at the start of the synthesis; a failed night shows "No briefing this morning…". Either way, yesterday's briefing never sits there looking like today's.

On the page, a briefing whose `date` isn't today gets the "No briefing yet today. Showing …'s" line. "Today" is the **Chicago** date (`chicagoDate()` in `app.js`). Until 2026-10-14 the check used `toISOString()`, which is UTC and rolls over to tomorrow at 7pm Central (6pm in winter), so every evening the current briefing was labeled as stale.

The full edition, with every source behind each story and what was dropped, is at `briefing-retrieval.clintsievers.workers.dev/brief`.

### The Notion pages
- `33af8d21…` — **story log**. The Worker appends each day's stories here as a readable archive; it is no longer pruned to 7 days. Story fatigue reads the Worker's own 7-day copy in KV.
- `3a2f8d21…` — **deep-dive log**. Each Sunday long read is appended, and it's read for the 28-day no-repeat rule. Load-bearing: don't delete it.
- `367f8d21…` — old dashboard data page. Nothing reads it; safe to delete.

Both logs need the Worker's Notion integration connected (page ⋯ → Connections).

---

## Current sections

| Section | Source | Notes |
|---|---|---|
| Weather | Open-Meteo | Live; retry + refresh |
| Briefing synthesis + headlines | Worker `/` | Written by `briefing-retrieval` |
| Something to sit with | Worker `/` | config.js fallback; "Earlier this week" strip from `/sitwith` (Mon–Sat) |
| Last week's reads | Worker `/sitwith` | Sundays only |
| Your teams | Worker `/sports` | Team news, no scores |
| Today's workout | Static link | See below |
| Today (calendar) | Worker `/calendar` | Live; ICS feeds, Chicago time; read key |
| Treasurer tasks | Worker `/tasks` | Live; JELC Notion, due + settled; read key |
| Daily devotion | Worker `/devotion` | Live; WELS RSS, verse + excerpt |
| On this day | Wikipedia | Live; 3 events |

### Removed (Oct 14, 2026)
The day-summary bar ("The goal before noon is one outreach"), Journal nudge, and Slow burns. All three were static placeholders filled from config.js. Markup, CSS, JS, and config all deleted, along with `renderSitWith()`, a config-only sit-with renderer nothing called.

### Removed (Sept 1, 2026)
Job search pipeline, JELS expansion, NYT Games. Markup, CSS, JS, and config all deleted.

### Orangetheory: why it's a dumb link
Reddit blocks programmatic reads of its JSON endpoints. `reddit.com/r/orangetheory/search.json` returns "blocked by network security" **even from a plain browser tab**. A Worker proxy does not help — the block is on Reddit's side, not the browser's. The sanctioned route is Reddit's OAuth API, which isn't worth a client secret for one link.

So the card is a static link. It can't tell you whether today's thread is up. It saves the hunt for it.

(For the record: the daily thread is generated the *evening before* and titled with the date it's for, so `created_utc` is the wrong field to filter on. The live thread is identified by mod-set **flair**, not by title — titles can't be edited on Reddit, flair can.)

---

## Refresh behavior

`init()` splits into `renderStatic()` and `loadLiveData()`. Live data re-pulls on:
- `visibilitychange` when the app returns to foreground (60s cooldown)
- `online` when the device reconnects

This exists because the dashboard runs as a standalone iPad app and a single page load can sit open for days. Without it, a fetch that failed at 6am stays failed until a manual reload — a two-second network fault becomes an hours-long blank card.

**Note:** after deploying `app.js`, the iPad may serve a stale bundle. Force-quit and reopen.

---

## Recurring lesson

Three separate bugs this week were the same shape: **a field that seemed to carry meaning didn't.**

- Reddit's `created_utc` recorded when a bot ran, not what day the content was for
- A cached response looked identical to a live one
- The `sources` diagnostic block was added precisely because a failed fetch looked like a quiet news day

Before filtering on any field, ask whether it carries the meaning you think it does, or whether it's just a number that happens to be nearby. Authoritative beats inferred — mod-set flair beats a parsed timestamp, a publisher's slug beats a keyword in a description.

---

## Backlog
- ~~Google Calendar integration~~ — **done** via `/calendar`. Apple/iCloud still pending: the `CAL_ICS_2` slot is wired and unset (see Family calendar below).
- ~~Notion church tasks~~ — **done** via `/tasks` (Treasurer tasks card).
- JELC Council numbers (pulled from the JELC Council dashboard, not hand-maintained)
- ~~Daily Bible verse~~ — **done** via `/devotion` (WELS Daily Devotions).
- Personal daily brief alongside the news briefing
- ~~Shorter, punchier briefing summaries~~ — **done**: one or two lines each since the move to `briefing-retrieval` (Oct 2026).
- ~~Decide whether league fill earns its slots~~ — capped at 3, headline-only (Oct 2026). Revisit if the card feels thin.
- Cleaner Worker URL via a `clintsievers.com` subdomain (deliberately deferred)
- ~~git for the Worker~~ — **done**, source is now `worker.js` in the repo. Consider wrangler too once it outgrows one editor screen (deploy is still a manual paste into the Cloudflare editor).
- **Bible card:** this Sunday's lectionary readings (JELC follows the lectionary), spread across the week as references only, with no text, so it sends Clint to his Bible. Not the three-year reading plan.
- **Strategy Muse card**, behind the read key: a few lines (next milestones, hours against plan). The tracker is an Apps Script in the Strategy Muse Google account and can serve a minimal summary. The project plan is a Claude.ai artifact the Worker can't read, so it needs a copy that's refreshed whenever a workstream is fleshed out.
- **Family calendar** in the `CAL_ICS_2` slot, waiting on sharing the family Apple calendar. Preferred over a school or community calendar.
- **Delete the `/sitwith` SEED** in `worker.js` after Oct 21, 2026, once the archive itself covers a full week.

---

## Design system
Warm light theme. CSS custom properties in `:root` in `index.html`.

- `--bg` / `--bg-2` / `--bg-3` — background layers
- `--ink` / `--ink-2` / `--ink-3` / `--ink-4` — text hierarchy
- `--accent` — warm terracotta `oklch(0.600 0.152 32)`
- `--pos` / `--neg` / `--warn` — status colors

Fonts: Geist (sans), Instrument Serif (display), Geist Mono (mono), via Google Fonts.

Grid: 12-column, `var(--gap)` gutters. Briefing runs 8 wide; devotion/weather/today/teams stack in a 4-column rail (the workout link is a footer line on the Today card); the long-read card spans full width as a divider, with the "Earlier this week" strip at its foot Mon–Sat, or the full-width "Last week's reads" card under it on Sundays. Below "The rest of the morning", Treasurer tasks runs 8 wide with On this day 4 wide beside it. On this day is sized to its own content (`align-self: start`), not stretched to the tasks card's height. Under 900px everything stacks to full width; under 700px the strip goes to one column.

The rail should end near where the briefing does. It grows with calendar events and sports items, the briefing with story count — when adding a rail card, check both columns at 1194 wide on a full sports day, not just a quiet one.

Installs as a standalone iPad app (11", landscape) via web app manifest + home screen icons. Screenshots for layout work: 1194×834 at deviceScaleFactor 2.
