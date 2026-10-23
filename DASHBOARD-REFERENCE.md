# Morning Dashboard — Architecture Reference

Last updated: October 23, 2026

## What this is
A personal morning dashboard for Clint Sievers, hosted on GitHub Pages. Plain HTML/CSS/JS — no framework, no build step. It exists to replace aimless scrolling with a purposeful briefing.

**Live URL:** `https://clints81.github.io/dashboard`
**Repository:** `github.com/clints81/dashboard`
**Worker:** `briefing.clintsievers.workers.dev` (source in `dashboard-worker/`, deployed with `npm run deploy` from that folder)
**Briefing Worker:** `briefing-retrieval.clintsievers.workers.dev` (source in `briefing-retrieval/`, deployed with `npm run deploy` from that folder)
**Orangetheory sync:** `github.com/clints81/otf-sync`, a **private** repo whose scheduled GitHub Action PUTs workout data to the Worker (see The Orangetheory card)

Repo files:
- `index.html` — structure and design (edit rarely)
- `config.js` — personal data layer (edit regularly, no coding required)
- `app.js` — runtime logic and data fetching (edit for feature changes)
- `dashboard-worker/` — the Cloudflare Worker: source in `src/index.js`, config in `wrangler.toml` (edit, commit, then `npm run deploy` from that folder)
- `briefing-retrieval/` — the Worker that writes the briefing overnight; its own `README.md` and `DESIGN.md` (see The briefing system)
- `DASHBOARD-REFERENCE.md` — this file
- `course/` — a training course on how the dashboard works (see below); kept off the Pages site by `_config.yml`
- `_config.yml` — GitHub Pages (Jekyll) settings: excludes `course/` from the site
- `briefs/` — briefs from the planning chat, **gitignored** (local only; see below)

Everything in this repo is public and served by GitHub Pages. Secrets live in Cloudflare and 1Password, never here.

**Briefs** (since 2026-10-18): a brief written in the planning chat is saved to `briefs/` for Claude Code to read. The folder is in `.gitignore` because briefs can hold private context (the calendar brief named the family calendar and a trip), and committing one would publish it. Briefs aren't kept in git at all: once one is built, its decisions and reasons live in this file, so the brief is disposable.

**The course** (since 2026-10-23): `course/` teaches Clint how the dashboard works using its own code, so he can follow Claude Code's tool calls, diffs, git steps and approval prompts, and ask sharper questions when something breaks. `course/README.md` is the index: a one-page map and a glossary (the 5-minute refresher), then seven ~10-minute lessons (what runs where; fetched vs. generated; keys and secrets; tool calls, diffs and tests; branches to deploys; approval prompts; when something breaks). Each lesson lists the files it depends on, and `CLAUDE.md` requires updating the matching lessons whenever a change affects architecture, data flow, keys or deployment. No secret values appear in it.

- **Kept off the live site.** Pages builds this repo with Jekyll (there's no `.nojekyll`, `_config.yml` or Actions workflow), which publishes every file whose name doesn't start with `_` or `.`. So `_config.yml` lists `course` under `exclude`. That only holds while Pages builds with Jekyll from a branch: switching to an Actions workflow or adding `.nojekyll` would publish `course/` again. It couldn't be checked from the cloud session (`github.io` is blocked there), so it's in the Backlog to confirm after merge.
- **Still public on github.com**, like the rest of the repo. Clint OK'd that on 2026-10-23: the course describes where keys live and which routes are locked, which this file already says publicly.

---

## The Worker

`briefing.clintsievers.workers.dev` is a Cloudflare Worker Clint owns, named `briefing`. Its source is **`dashboard-worker/src/index.js`** and its config is **`dashboard-worker/wrangler.toml`**. The flow: edit `src/index.js`, commit, then `npm run deploy` from `dashboard-worker/` (run `npm install` there once first).

- **Never edit in the Cloudflare editor.** The deployed Worker and the repo would drift apart, and the next deploy silently reverts the change.
- **Don't change bindings or variables in the Cloudflare dashboard either.** `wrangler.toml` is the whole config: a deploy removes any binding, variable or trigger that isn't in it. Change the file and deploy instead. Secrets are the exception: they aren't in the file and survive deploys (checked on the first deploy). Set them with `npx wrangler secret put <NAME>` from `dashboard-worker/`.
- **The name must stay `briefing`.** `briefing-retrieval` reaches this Worker through two service bindings by that name, `COWORK` and `DASHBOARD`. The Cloudflare dashboard shows them on this Worker as a "briefing-retrieval (fetch)" trigger; they're configured in `briefing-retrieval/wrangler.toml`, not here.

**Moved to wrangler on 2026-10-20.** Until then the Worker was a single file pasted into the Cloudflare editor. The move came first, on its own, because the next calendar change (replacing the hand-built parser with ical.js, in the Backlog) needs an npm import, which a pasted file can't do. Keeping the deploy change separate means a break after the parser change is the parser, not the deploy. The move was meant to change no behavior: the code moved byte-identical (`git mv` from `worker.js`, so `git log --follow` keeps its history), and `wrangler.toml` copies the live settings rather than new ones:

| Setting | Value |
|---|---|
| Compatibility date / flags | `2026-08-30`, none (set when the Worker was made) |
| Bindings | KV `BRIEFING` → `briefing-store` |
| Secrets | `CAL_ICS_1`, `CAL_ICS_2`, `NOTION_TOKEN`, `READ_KEY`, `WRITE_KEY` |
| Observability (Workers Logs) | on |
| Triggers | `workers.dev` only: no routes, custom domains or crons |
| Preview URLs | on (`preview_urls = true`, stated so it doesn't ride on wrangler's default) |
| Git builds | **none** (disconnected 2026-10-21, see below) |

Checked after the deploy: all five secrets still listed, and every GET route matched a baseline taken just before (status, CORS and cache headers, and the shape of each body), and the dashboard loaded with the key.

If a deploy breaks something, `npx wrangler rollback` (or Deployments in the dashboard) restores the previous code, but may not restore a binding or variable a deploy removed. For that, put it back in `wrangler.toml` and deploy again.

### The Git build outage (2026-10-20 to 10-21)
The `briefing` Worker was also connected to this GitHub repo through Cloudflare's Git builds (Settings → Build), which the pre-move check missed: it covered bindings, triggers, routes and observability, not Build. Pushing the move to `main` (5:46pm Central) started a build that ran wrangler at the repo root. With `worker.js` gone from the root and no `wrangler.toml` there, wrangler set the repo up as a **static site** and deployed it two minutes later: no Worker code, no `BRIEFING` binding, no secrets. `/` served the dashboard's own `index.html`, every other route was 404, and every Worker card failed overnight. Weather and On this day still loaded, since they don't use the Worker. That night's briefing PUT and otf-sync's 3:40am PUT failed; the KV data itself was untouched.

Fixed 2026-10-21 about 9:14am Central: Clint rolled back to the last good version (`4596e16b`), which brought back the code, the binding and the secrets (a Worker version keeps its own copy of its secrets), and disconnected the Git build. **Keep Git builds off.** Deploys are a deliberate `npm run deploy`; a build on push would put every commit live, documentation-only ones included.

The lesson: when checking that a config file matches what's live, the list to check is everything the dashboard can change, not just what the code uses. Ask for the whole Settings page.

**Secrets after the rollback (fixed 2026-10-21).** A rollback makes an old version live but doesn't make it the newest version, and `wrangler deploy` carries secrets over from the newest one. After the rollback the newest was still the static build, with no secrets, so `wrangler secret list` read `[]` while the live Worker had all five. Confirmed by uploading the repo as a version without deploying (`wrangler versions upload`): its preview URL answered `READ_KEY unset`. A plain `npm run deploy` would have taken the dashboard down again.

The fix, with no downtime: Clint re-entered each secret on that undeployed version (`npx wrangler versions secret put <NAME>`, values from 1Password and the calendar apps, at hidden prompts), which made a new version per secret. Before deploying, the last one was checked against the live version, which still held the originals: every GET route gave identical bodies from both with the same keys, and the write key was tested with a PUT to `/otf` whose body isn't JSON. That is refused before any write, `400 invalid JSON` for the right key and `403` for a wrong one, so it tests the key without touching data. Then `npx wrangler versions deploy <id>@100%`. Afterwards `wrangler secret list` shows all five again.

**After any rollback,** remember the newest version may not be the live one. Check `wrangler secret list` before the next deploy; if it's short, use the same fix.

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
| `/otf` | PUT | Stores the otf-sync payload in KV (key `otf-sync`). Requires `X-Write-Key`, same key as `/`. A failed sync keeps the last good data. See The Orangetheory card. |
| `/otf` | GET | Last good Orangetheory data plus the last sync attempt. **Requires `X-Read-Key`.** CORS `*`. 5-min cache, dropped on every PUT. |

The write key is `WRITE_KEY` in this Worker's Cloudflare settings, with copies in 1Password, as the `DASHBOARD_WRITE_KEY` secret on the `briefing-retrieval` Worker, and as the `DASHBOARD_WRITE_KEY` Actions secret in `otf-sync`. Rotating it means updating all three. It was rotated 2026-10-08, when it came out of the Cowork task text. Never in the repo. The other secrets (`CAL_ICS_1`, `CAL_ICS_2`, `NOTION_TOKEN`, `READ_KEY`) are Worker secrets too, listed by name in `wrangler.toml`.

Each route is one top-level name in `dashboard-worker/src/index.js` (`handleSports`, `CALENDAR`, `TASKS`, `DEVOTION`, `SITWITH`, `OTF`) plus one line in the `fetch` router. Follow that convention when adding a route — it's what keeps per-route constants (each block has its own `CACHE_SECONDS`) from colliding.

### Read key
`/calendar`, `/tasks` and `/otf` return Clint's schedule, the church's payables and his workout data, so they need a read key. Every other route stays public, `/sitwith` included: the picks aren't personal, and the computer bookmark should show them without a key.

Where the key lives:
- `READ_KEY` secret in this Worker's Cloudflare settings
- 1Password, item "Dashboard read key"
- Each device's browser storage (`localStorage["dashReadKey"]`), entered once per device on the card itself

Never in the repo. The page sends it as `X-Read-Key`.

How it behaves:
- **Worker.** `READ_GATE.check()` runs after OPTIONS (preflights never carry the key) and **before the cache lookup**, so a request without the key can never be served a cached copy. No key gets 401 `{"error":"locked","sources":{"auth":"missing"}}`, a wrong key gets `"rejected"`, and an unset `READ_KEY` fails closed with 500 `"READ_KEY unset"`. Refusals carry the CORS headers; without them the browser hides the status and "locked" looks like a network failure.
- **Caching.** The browser gets `cache-control: private, no-store`. The copy in `caches.default` keeps `public, max-age=300`, because `cache.put` refuses (413) a response whose Cache-Control says not to store it, and Cloudflare reads both `private` and `no-store` that way. `READ_GATE.forBrowser()` swaps the header on the way out.
- **Page.** With no key stored, the card shows "Locked on this device · Enter key" and doesn't fetch. If the Worker answers 401, the card shows "Key rejected · Re-enter key". `fetchRetry` doesn't retry a 401. Any other failure keeps the card's normal "… unavailable" line. Saving a key reloads only the three protected cards.

To rotate: generate a new value in 1Password ("Dashboard read key"), run `npx wrangler secret put READ_KEY` from `dashboard-worker/` and paste it at the hidden prompt (this deploys a new version of the live code with the new key; the other secrets carry over), then re-enter the key on each device. Devices show "Key rejected" until you do.

**Rotated 2026-10-21.** During the calendar testing, a helper script passed the key to `curl` as a command-line argument, and a process listing taken to check progress showed it in a Claude Code session transcript. It never reached a file or the repo, but it was treated as exposed. So: **scripts that use the read or write key pass it to `curl` through stdin** (`curl -K -` fed a `header = "X-Read-Key: …"` line), never as an argument, since any process listing shows arguments.

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
- **Orangetheory** — Worker `/otf` route, filled by the otf-sync Action. See The Orangetheory card.

All of these go through `fetchRetry()` in `app.js`: one retry after 2.5s, and a non-200 is treated as failure rather than parsed as JSON. The thrown error carries `.status`. A 401 is not retried, so the key-protected cards can tell "locked" from "broken".

### Static (config.js)
- Fallback "something to sit with" (shown only if the briefing fetch fails)
- Orangetheory subreddit name, and the fallback monthly goals (`CONFIG.otf.goals`; Notion's row wins)
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

`/calendar` fetches ICS feeds (`env.CAL_ICS_1` = Google's secret iCal URL; `env.CAL_ICS_2` = the family Apple calendar, **live since 2026-10-18**) and returns today's events. The browser can't do this itself — it can neither hold the secret URL nor fetch `calendar.google.com` cross-origin.

**Adding an Apple feed:** Apple's share link is `webcal://…`. Change it to `https://…` before saving it as a secret; `webcal` is only a hint for calendar apps, and the Worker fetches over `https`. Family events merge into the same list as Google's for now; how they look on the card is a separate decision.

### How an event gets onto a day (since 2026-10-21)
The parser is **ical.js 2.2.1** (pinned exactly in `dashboard-worker/package.json`), with a strict split of work:

- **ical.js decides which occurrences exist:** parsing, `RRULE` (including `BYDAY` ordinals, `BYSETPOS`, `BYMONTH`, `BYMONTHDAY`), and `EXDATE`.
- **The Worker decides when they are.** Each occurrence comes back as wall-clock fields (year, month, day, hour, minute, second), and the Worker turns those plus the event's `TZID` into an instant with its own code: `resolveZone()`, then `wallToUTC()`. `Z` times are UTC; a time with no `TZID` and no `Z` is Chicago. End times are the event's own `DTEND` minus `DTSTART`, worked out the same way and added to each occurrence.

**Why the split: the floating-time trap.** ical.js only knows a zone whose `VTIMEZONE` it has been given. Any other `TZID` becomes "floating", and ical.js reads a floating time in the runtime's own zone. A Worker runs in UTC, so a 10:00 Chicago event would come out at 10:00 UTC, 5am Chicago. On a Mac set to Chicago the same code gives the right answer, so a local test passes while the deployed Worker is five hours off. So **`toJSDate()`, `toUnixTime()` and `convertToZone()` are never called in the calendar code**, and the test script refuses to run unless `TZ=UTC`.

**Why each event is parsed on its own.** `ICAL.parse` is all-or-nothing: one bad line anywhere (a line with no colon, `FREQ=SOMETIMES`, an unclosed `VEVENT`, an unmatched quote) throws for the whole file. That is the Oct 18 outage again, through a library. So the Worker cuts the file into one chunk per `VEVENT` and parses each in its own `try`. The `VTIMEZONE`s are cut out too and hung on one parent component that every event points to, so ical.js knows every zone the file defines. That matters for its `UNTIL` and `EXDATE` comparisons. As a backstop, the Worker also checks each `EXDATE` itself, as an instant: in a test, a UTC `EXDATE` on a series whose zone had no `VTIMEZONE` was silently ignored by ical.js.

**Why there's a cheap pass first.** The family feed has about 5,000 events, and building ical.js objects for all of them costs seconds. Before anything is parsed, the raw lines decide whether an event could touch the target day: a one-off whose `DTSTART` date is within a day of it (the margin covers every zone offset), a series whose `UNTIL` isn't before that, or a moved instance whose new or original date is near it. A `DTSTART` the pass can't read keeps the event, so ical.js gets to fail on it and it's counted. With the pass, a request takes less CPU than the old parser did (see CPU below).

**Repeats are bounded.** A rule with no `COUNT` and no `UNTIL` is legal and infinite, so each series stops once it passes the day, and a series that needs more than 4,000 steps to reach the day is counted in `skipped` (a daily series from 2000 would). The real feeds' longest active series needed about 18 steps on 2026-10-21.

**What was wrong before** (the old hand-built expander, replaced 2026-10-21):
- It ignored `BYDAY` on monthly and yearly rules, its ordinal (the `3` in `3TU`) and `BYSETPOS`, so a "third Tuesday" series repeated on the day of the month it started on. Seen live in October: a monthly third-Tuesday and third-Wednesday pair in the family calendar showed on the 21st and the 19th (the dates their first instances fell on) instead of the third Tuesday and Wednesday. A third-Friday meeting in Google showed on the 20th. The real feeds checked on 2026-10-21 had six such series wrong between October and December, including a second-Monday meeting and two household reminders with month-and-weekday rules. The rest were plain yearly dates, which the old code got right.
- A monthly rule on the 31st rolled into the next month (Nov 31 became Dec 1) instead of skipping it.
- An email reminder inside an event (`VALARM` with its own `SUMMARY:Alarm notification`) overwrote the event's title, so some Google events showed as "Alarm notification". ical.js reads the event's own `SUMMARY`.

**CPU, and the Free plan's limit.** This account is on the Workers Free plan, whose limit is 10 ms of CPU per request. `/calendar` has never fit: the family feed is a 4 MB file of about 5,000 events going back years, and just unfolding and splitting it takes 15–30 ms before any parsing. Cloudflare lets a request overrun some of the time, and kills it with error 1102 ("Worker exceeded resource limits") at other times, more often under load. Measured 2026-10-21 from the live log (`wrangler tail`, which records `cpuTime` per request but not for preview URLs):
- During the October–December sweep (two requests a second, old code live), 62 of 132 old-code `/calendar` requests were killed for CPU. The ones that got through used 224–1,041 ms.
- A 50/50 split of live traffic between old and new, 30 keyed requests about 10 seconds apart: **new median 257 ms** (161–490, 17 requests), **old median 370 ms** (279–833, 12 requests). None killed. So the new parser uses about 30% less CPU, and it's still 25 times over the limit.

The page's `fetchRetry` retries once, and responses are cached for 5 minutes, so in normal use this shows as an occasional "unavailable" calendar card, not a broken one. Staying on the Free plan and accepting that was Clint's call on 2026-10-21 (in the Backlog, to revisit).

**Verified 2026-10-21 before deploying:**
- `npm run test:calendar` passes.
- Old and new code run locally on downloads of both real feeds (in a scratch folder, deleted afterwards, never committed) for every day from Oct 1 to Dec 31: the only differences were the six repeating series above and the "Alarm notification" title.
- The new code uploaded as a version without deploying, and `/calendar` fetched from live and from that version's preview URL back to back for each of the same 92 days: on the 62 days where both answered (the rest hit the CPU limit on one side), every difference was one of those expected fixes, and the `sources` lines matched exactly.

Deployed as that exact version (`5e397d72`) with `wrangler versions deploy`. (The read-key rotation later that day made `01f3ecd3`: the same code with the new key.) The calendar card showed the corrected third-weekday series the same day.

**Testing.** `npm run test:calendar` from `dashboard-worker/` runs `scripts/calendar-test.mjs` with `TZ=UTC`: a made-up feed through the Worker's real `/calendar` handler, checked day by day. It covers third-weekday rules both ways (`3TU` and `BYSETPOS=3`), a New York third-Friday on both sides of Nov 1, the 31st, `EXDATE`s (one in UTC on a zone with no `VTIMEZONE`), a moved instance, a `GMT-0500` event, a zone with no `VTIMEZONE`, an unknown zone, an all-day event, a cancelled event, and three unreadable ones. The old code fails it in the same ways the real calendars went wrong.

Load-bearing details, learned the hard way:
- **Times are wall-clock in `America/Chicago`, not UTC.** The block converts a zoned time to a UTC instant by guessing, measuring the error, and correcting (two passes settles DST boundaries). This is why a 9am standing meeting stays 9am after the November clock change.
- **All-day events keep their date string**, built from the occurrence's year, month and day. Round-tripping them through a UTC instant is how all-day events end up on the wrong day. The date is the fact, not the timestamp.
- **ICS lines fold** at 75 octets (a continuation line starts with space/tab); the file is unfolded before it's cut into events.
- An event shows on the day it starts. A multi-day event doesn't repeat on its later days (unchanged from before).
- The `sources` block reports each feed as `ok (N in file, M on YYYY-MM-DD)`, `unset`, `HTTP nnn`, `not-ics`, `empty-file`, or `error: …` — same rule as `/sports`: a blocked feed and a genuinely empty day must not produce identical JSON. Two counts are appended when they aren't zero, e.g. `ok (212 in file, 3 on 2026-10-18, 1 skipped, 2 fallback)`:
  - **`skipped`**: events that couldn't be read: one that threw while parsing or expanding, had no usable `DTSTART`, hit the step cap, or was cut off mid-file. **This is the one to watch**: without it, a dropped event and a free afternoon look identical. Since ical.js, it counts the events the cheap pass let through (always every series, every moved instance near the day, and anything whose date can't be read) plus any broken `VEVENT`, not every event in the file: one the pass sets aside is never parsed, so it can't fail.
  - **`fallback`**: events whose `TZID` is neither a standard zone name nor an offset label, shown as Chicago time. Counted across the whole file, from the raw lines.
  - `N in file` counts every `VEVENT`, skipped ones included. `error: …` is kept for download failures of the whole feed.
  - **No `unsupported` count** (planned, then dropped 2026-10-21): with ical.js, a rule it can't expand throws, and `skipped` already reports that.
- `?date=YYYY-MM-DD` points the route at another day, for verifying parsing without waiting for a morning.
- Key-protected: send `X-Read-Key` (see Read key).
- **One bad event never sinks the feed.** Each event is parsed and expanded on its own; a failure skips that event and counts it in `skipped`. Until 2026-10-18 one unreadable event threw out of the whole feed, and `sources` read `error: …` with no events at all.

### Time zones (`TZID`)
Added 2026-10-18. Apple exports zones it can't name as labels like `GMT-0500` and `GMT+0200` (events created while traveling). `Intl` throws on those, and the first iCloud fetch failed whole with `error: Invalid time zone specified: GMT-0500`.

How a `TZID` is read (`resolveZone()` in the `CALENDAR` block):
- **Standard zone name** (`America/New_York`, `US/Central`): as before, through `Intl`.
- **Offset label** (`GMT±HHMM`, `GMT±HH:MM`, `UTC±…`, a bare `±HHMM`): a fixed offset, converted with plain arithmetic. Not `Intl` with an offset string, and not `Etc/GMT±N`, whose sign runs backwards.
- **Anything else `Intl` rejects:** Chicago, counted as `fallback`.
- No `TZID` and `Z` (UTC) times: unchanged.

A recurring event repeats in its own zone, so a `GMT-0500` series keeps its offset and a New York series keeps New York wall-clock. Before, every series was expanded in Chicago. That gives the same times for US zones, which all change clocks on the same dates. Parameter values are read quote-aware (ical.js, and the cheap pass's own `TZID` reader), since a value holding a colon must be quoted (`TZID="GMT-05:00"`).

**The principle: the stated offset is authoritative; our guess about intent is not.** What the family feed showed on 2026-10-18 (counts only, nothing from the file kept, and per-label counts left out because this repo is public): about 5,000 events, under 100 of them using one of 8 offset labels, `GMT-0500` the most common. Each label's `VTIMEZONE` defines a single fixed offset with no daylight rule. None of those events recur, and none are dated today or later. Run locally against the real feed, the new code reads `ok (… in file, 2 on 2026-10-18)`, with nothing skipped or fallen back.

**Known DST tradeoff, accepted knowingly.** If Apple wrote `GMT-0500` but really meant Chicago, a new such event after the November 1 change shows an hour early (10:00 `GMT-0500` = 9:00 CST). No future event uses a label today. The Backlog has a check for after Nov 1.

To verify after a deploy, `sources.icloud` should read `ok (…)`:

```
curl -H "X-Read-Key: …" "https://briefing.clintsievers.workers.dev/calendar?t=1"
```

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
| Orangetheory | Worker `/otf` | Today's lookahead, last class, month vs goal, workout-thread link; read key. See below |
| Today (calendar) | Worker `/calendar` | Live; ICS feeds, Chicago time; read key |
| Treasurer tasks | Worker `/tasks` | Live; JELC Notion, due + settled; read key |
| Daily devotion | Worker `/devotion` | Live; WELS RSS, verse + excerpt |
| On this day | Wikipedia | Live; 3 events |

### Removed (Oct 14, 2026)
The day-summary bar ("The goal before noon is one outreach"), Journal nudge, and Slow burns. All three were static placeholders filled from config.js. Markup, CSS, JS, and config all deleted, along with `renderSitWith()`, a config-only sit-with renderer nothing called.

### Removed (Sept 1, 2026)
Job search pipeline, JELS expansion, NYT Games. Markup, CSS, JS, and config all deleted.

## The Orangetheory card

Added 2026-10-17, replacing the static Reddit link. Two jobs: stop entering every class into Notion by hand, and help Clint prepare for class in the morning. Planned in the dashboard chat on 2026-10-17. Phase 1 (the sync, the last class, the month) and Phase 2 (the monthly post and today's lookahead) are both built.

### Decisions
- **Orangetheory's own data is the system of record.** It already holds the full history, so nothing is copied into Notion. A copy would be a second store to keep in sync.
- **Nothing writes to Notion.** The Notion "OTF Class List" database (~1,387 classes) is frozen as an archive once Clint reaches class 1400, about a month out. He keeps entering by hand until then, on purpose.
- **Notion's only future role** is holding what only Clint can supply: the r/orangetheory monthly post, pasted in once a month, and that month's goals (Phase 2, below).
- **Workout focus is dropped.** Clint's "Strength" tag meant the block focus, not a Strength 50 class. OTF doesn't publish focus in advance, and comparing a repeat to its own earlier template is already like-for-like.
- **Target cost is $0.** otf-api is MIT-licensed, the Action runs ~3 times a day well inside the free 2,000 private-repo minutes, and there are no model calls.
- **No manual override yet** (asked 2026-10-17: studio tech sometimes records wrong numbers). It's rare, the card shows one class and month totals, so a bad value shifts one glance and one month's sum. If it's ever needed: a small overrides file in the private otf-sync repo, keyed by class start time, that the job applies and the card marks as corrected. Not Notion, per the decision above. In the Backlog.

### otf-sync (where the code runs)
otf-api is Python and logs in through OTF's AWS Cognito pool, caching tokens and a device key on disk. Neither Worker can host that (JS, free plan, no disk, ~10ms CPU). So it runs as a **scheduled GitHub Action in the private repo `clints81/otf-sync`**. It's private because this dashboard repo is public and Action logs in a public repo are public. Its `CLAUDE.md` forbids printing workout data or credentials to the log; the job prints counts and statuses only and silences otf-api's logger, which logs raw responses and the account email on some error paths.

- **Secrets** (Actions secrets, copies in 1Password): `OTF_EMAIL`, `OTF_PASSWORD`, `DASHBOARD_WRITE_KEY`, `NOTION_TOKEN` (Phase 2).
- **Schedule** (UTC cron, can start late): 08:40, 15:40, 23:40 UTC, i.e. 3:40am, 10:40am and 6:40pm CDT (an hour earlier in CST). The first keeps the morning fresh; the other two pick up a class the same day. Also runnable by hand (workflow_dispatch).
- **Pinned:** otf-api 0.21.1 and every dependency, in `requirements.txt`. Upgrading otf-api is its own change.
- **`TZ: America/Chicago` on the runner** is load-bearing: otf-api compares class start times (studio local, no zone) with the machine's clock, and a UTC runner would count a class later today as already done.
- **Login: refresh token first, password only as a fallback.** Verified 2026-10-17 by reading otf-api and a one-off probe: otf-api never sends the cached device key with a password login, so each password login registers a new Cognito device; and it caches tokens for about an hour only, so runs hours apart would all be password logins. So `sync.py` keeps its own copy of the tokens (`~/.cache/otf-sync/tokens.json`) and refreshes with the cached device key. The probe confirmed the refresh works. Whether devices were piling up can't be seen from our side: Cognito's device list came back empty even right after a login. Each run reports which path it used (`sources.login`: `ok (refresh)` or `ok (password; refresh: …)`); the first password fallback will show OTF's refresh-token lifetime.
- **Login state between runs** is saved with `actions/cache` (both `~/.cache/otf-api` and `~/.cache/otf-sync`), one entry per run, restored newest-first by prefix. It holds a live refresh token, another reason the repo stays private.

### The payload
`PUT /otf` with `{attempted_at, ok, sources, data?}`. `ok` is false when the login or the workout fetch failed, and then there's no `data`.

- `sources`: `login`, `workouts` (`ok (N)` or `failed: <type>`), `parse`, `benchmarks`, `month_stats`, `upcoming`, `post` (Phase 2, e.g. `2026-10 ok; 2026-11 empty`), and `new_class_types` when OTF sent a class type otf-api doesn't know (see below). **`parse` is the "fetched but didn't parse" check.** otf-api drops a booking it can't read (a new class type, a renamed field) and only logs it, which would read as "no class". The job compares raw bookings, parsed bookings and workouts over the same window and reports any gap, e.g. `1 of 33 bookings didn't parse`.
- `data.workouts`: the last 45 days (so a repeat's original is included), newest first. Per class: `start` (studio local, no zone), `type`, `name`, `coach`, `attended`, `has_data`, `splats`, `calories`, `steps`, `avg_hr`, `peak_hr`, `zones` (whole minutes), `tread` {`miles`, `avg_mph`, `max_mph`, `elev_ft`}, `rower` {`meters`, `pace_500m`, `watts`}.
- `data.month`: `key` (YYYY-MM, Chicago), `classes`, `tread_miles`, `rower_meters`, summed from the classes, plus OTF's own month totals as `otf_reported`, a cross-check only. They carry no unit label, but they're meters: on 2026-10-17 OTF's tread total was 29,612, exactly the 18.4 miles summed from the classes.
- `data.benchmarks`: each benchmark with OTF's ID, name, unit (`mi`, `m`, `time`), best/last/previous and the last 10 dated results, already converted (below). `otf_unit` keeps OTF's own unit. Body-weight challenges (unit `lb`) are left out.
- `data.upcoming` (Phase 2): booked classes from today through the next 13 days, `{start, type, name, status}`, canceled ones left out.
- `data.plan` (Phase 2): the monthly post and the lookahead. See Phase 2 below.

Fields that don't mean what they seem (verified 2026-10-17):
- **`peak_hr`, not `max_hr`.** otf-api's `max_hr` is the member's configured maximum. The highest heart rate in the class, Notion's "Max heart rate", is `peak_hr`.
- **Numbers come from OTF's display values** (`"2.41"` miles, `"1,250"` m), the numbers the app shows and Clint copied into Notion, so month sums match the old Notion totals. Units the probe saw: tread miles, mph, feet; rower m, min/500m, watts.
- **The class type is a reliable field; 2G/3G is not.** otf-api knows ORANGE_60, ORANGE_90, STRENGTH_50, TREAD_50 and OTHER. 2G vs 3G exists only in the name ("Orange 60 Min 2G"). Clint's studio names are consistent (120 days: 53 × 2G, 2 × 3G, 1 Tornado, 10 Strength 50, 2 Tread 50).
- **OTF has more class types than otf-api knows.** The first dry run (2026-10-17) reported `1 of 25 bookings didn't parse`: a Hyrox class, type `HYROX_60`, which otf-api 0.21.1 (the newest) rejects, dropping the whole class. So `sync.py` reads an unknown type as OTHER before otf-api parses it, keeps OTF's real value in the payload's `type`, and lists it in `sources.new_class_types`. The card labels such a class by its name. The `parse` check stays for any other kind of breakage.
- **A class can have no data.** Phone left at home: attended, no performance summary. The card says "Attended · nothing recorded".
- **Benchmark names don't match the monthly post** ("12 MIN Treadmill" vs "12 Minute Tread for Distance"). Phase 2 matches on OTF's benchmark ID through a hand-made table (`BENCHMARK_IDS` in otf-sync's `post.py`), not on names. The list also covers specialty workouts (Orange Everest, Inferno, Catch Me If You Can), which Clint tracks the same way.
- **OTF's "km" really is km** although the app shows miles. Checked 2026-10-17: all 7 of Clint's 12-minute results in Notion's Benchmark info match OTF's at a ratio of 1.609. `sync.py` converts km to miles for every benchmark OTF reports in km (12 MIN Treadmill, Orange Everest, Catch Me If You Can, Marathon Month).
- **Timed benchmarks arrive as text**, `"01:27.94"` or `"06:38"`, matching Notion exactly (500m, 1000m and 2000m rows, 1 mile, quarter mile). The card drops the leading zero. Two 1-mile results in Notion marked "PW" (3/23/26, 6/16/25) have no OTF result those days; probably logged as power walker.

### Phase 2: the monthly post and today's lookahead
Built 2026-10-17 from the Phase 2 brief. On a class morning the card answers: is this a repeat, and how did the original go? Is today a benchmark, and what's my last and best? Is a special event on?

**Setup (by Clint):**
- Notion database **"OTF Monthly Posts"**: database `3fcf8d21-7e64-8067-9827-e4fff9c8fc02`, data source `3fcf8d21-7e64-80f7-b86c-000be82765d9`. One row per month: **Month** (title, exactly `YYYY-MM`), **Tread Goal**, **Rower Goal**. The page body is the **whole** r/orangetheory monthly post, pasted as-is.
- A Notion connection **"otf-sync"** (internal, read content only, no user info), connected only to this database; rows inherit it.
- Actions secret **`NOTION_TOKEN`** in otf-sync, separate from the Worker's Notion token on purpose: the Action can open this one database and nothing else.

**Decisions:**
- **Paste the whole post**, not selected sections: picking sections on a phone is fiddly, and the job finds what it needs.
- **Re-paste when the moderator edits the post.** The card shows "post from <date>" from the page's last-edited time.
- **Goals move to Notion** with the config fallback (above).
- **otf-sync parses and joins**, not the Worker, so plan and results meet in one place. Trade-off: a fresh paste shows after the job's next run.
- **Benchmarks match on OTF's ID** through the hand-made table, not on names.

**How the job reads it** (otf-sync `plan.py` and `post.py`):
- Queries the data source for the rows of every month the lookahead touches, by exact title, and reads each page's blocks as plain text (Notion API `2025-09-03`). Markdown left in a paste (`**`, links, `- ` bullets) is stripped, so both read the same.
- **Key dates:** a single date or a range, name, kind (`benchmark`, `event`, `specialty`). The row's Month supplies the year; a December post naming January dates rolls over. An event's "attend class N out of M days" is read from its own bullet.
- **Repeats:** the "Repeat templates are as follows" pairs, for standard 60-minute classes. **Strength 50 and Tread 50** use the post's prose rule, coded rather than parsed: days 15–28 repeat days 1–14, and the 29th–31st are bonus templates. Tornado, 90-minute and Hyrox classes don't follow the repeat dates, so they get nothing.
- **3G-style dates** ("runs as 3G" even when the studio lists 2G) and **Run/Row dates** are read too.
- **The lookahead covers today and the next 13 days**, so a 6:40pm run is still right the next morning. The card reads only today's entry. Per day: booked classes (each with its repeat: the original's splats, tread miles at average mph and rower meters; or "missed", "no data" or "other format"; and "runs as 3G"), the day's benchmarks (last and best, already converted), events from a week before they start (with attended and booked counts against the post's goal), and the next benchmark with whether he's booked.
- **Fetching and parsing are reported apart** in `sources.post` and `plan.months[YYYY-MM].state`: `ok`, `empty`, `no row`, `unparsed (repeats)`, `unparsed (key dates)`, or `fetch failed: …` (a 404 means the connection can't see the database).

**On the card** (the "Today" block, a few lines):
- `6:15am 2G · Repeat of Wed 10/7: 20 splats · 2.75 mi @ 7.1 · 1,650 m`, or `· you weren't there`, `· nothing recorded then`, `· you took Strength 50 that day`.
- `500 Meter Row today · last 1:27.94 (Aug 8, 2025) · best 1:27.94`
- `Hell Week · 0 attended, 4 booked of 4 · starts Sat 10/24`
- `Next: Mon 10/19 · 500 Meter Row · booked`
- Empty states, never blank: "No monthly post for November yet." (no row), "No post pasted for November yet." (empty body), "Couldn't read this month's repeats." (or key dates), "Couldn't fetch this month's post.", and "Today's benchmark isn't mapped: <name as in the post>".
- With no booking today, only the event and next-benchmark lines show. With nothing to say and the post fine, the block is left out.

**Verified 2026-10-17:**
- October's post parsed end to end, shown to Clint before the card was wired: 3 key dates (10/15 12-minute tread, 10/19 500m row, 10/24–31 Hell Week), 6 repeat pairs, 3G on 10/26 and 10/31, Run/Rows on 10/5, 10/9, 10/22. Same result from plain text and from markdown.
- Bookings: 8 in the next 14 days, each with its class type. Today's class stays in the list after it starts ("Checked In"). No canceled booking was in the window to watch live; the library drops canceled bookings when asked, which the job does.
- The rows exist with exact titles; October has its body, November and December are empty. **`NOTION_TOKEN` from the Action verified on the first Phase 2 run** (2026-10-17, run 39060229438): `post: 2026-10 ok`, alongside `login: ok (refresh)`, `upcoming: ok (8)` and `put: ok`. If it ever stops, a token that can't open the database shows as `post: … fetch failed: HTTP 404`.
- A full local run with real OTF data and Notion mocked from October's post (paged blocks) gave today a Strength 50 repeat of 10/3 (missed: no class that day), 10/23 a repeat of 10/7 with its numbers, 10/26 "runs as 3G", and Hell Week at 0 attended, 4 booked of 4. The card was checked in every state above.

### Storage and route
KV key `otf-sync` in `env.BRIEFING` (named so it can't collide with `latest` or `sitwith-archive`), holding `{data, attempt}`. A failed sync updates `attempt` only, so the card keeps the last good numbers **and** says the sync failed. GET returns `{data, attempt, sources: {kv}}`, where `kv` is `ok`, `empty` (no sync yet), `unreadable` or `error: …`. Order inside the route: OPTIONS, then PUT (write key), then `READ_GATE.check()`, then the cache.

### On the page
Below "The rest of the morning", at the top of the 4-wide column beside Treasurer tasks, with On this day under it:
- **Last class:** day, time, format, coach; splats, tread miles at average mph, rower meters; zone minutes as a thin bar in OTF's five colors with the minutes beneath.
- **Today (Phase 2):** see Phase 2 below. It sits above the last class.
- **This month:** tread and rower miles against the goal, as two bars. **Goals come from the month's row in Notion "OTF Monthly Posts"** (Tread Goal, Rower Goal), field by field. A blank field falls back to `config.js` (`CONFIG.otf.goals`, default tread 32, rower 15), so a forgotten month means "the usual", never zero, and changing a goal needs no commit. Tread 32 is Clint's usual target; the rower goal is a bonus. (Before Phase 2, goals lived only in config, copied from the old Notion "OTF Months" database: tread 25–35, rower always 15. Note October's row in the new database says tread 30, not 32.) Rower miles = meters ÷ 1609.344.
- **Badge:** classes this month ("11 in Oct").
- **Never silently blank or stale:** a failed sync says so with its time and the date of the data shown; data older than 36h (`CONFIG.otf.staleHours`) says "Not updated since …"; a parse gap shows "Partial: …"; no sync yet says so. Locked and rejected key states work as on the other protected cards.
- **Footer:** the r/orangetheory link, which stays (below).
- `renderOtf` is split from the fetch inside `loadOtf`, and the states were checked against mocked payloads (good, failed login, stale, partial, no-data class, empty, unreadable, 401, 500).
- Verified end to end before the first deploy (2026-10-17): two local dry runs of `sync.py`, the second logging in by refresh (`ok (refresh)`), 25 workouts, 20 benchmarks, `parse: ok` after the Hyrox fix.

**Placement (Clint's call, 2026-10-17):** below the band, not in the top rail. He doesn't go every day, so he'd rather scroll to it than see it first. It also keeps the top rail at its old length: under Today it pushed the rail ~130px past the briefing on a quiet day. The lower column (`.rail-lower`) and the tasks card are each sized to their own content (`align-self: start`), so neither stretches to the other. Between 900 and 1000px wide the column stays beside tasks; under 900 everything stacks.

### The workout-thread link (why it's still a link)
Reddit blocks programmatic reads of its JSON endpoints. `reddit.com/r/orangetheory/search.json` returns "blocked by network security" **even from a plain browser tab**. A Worker proxy does not help — the block is on Reddit's side, not the browser's. The sanctioned route is Reddit's OAuth API, which isn't worth a client secret for one link. That decision stays closed: nothing reads Reddit programmatically. Clint reads the post himself and pastes the monthly post into Notion (Phase 2).

So the thread is a static link, now the footer of the Orangetheory card. It can't tell you whether today's thread is up. It saves the hunt for it, and it renders even when the card is locked or failing.

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

A related shape (Oct 18): **a field that looks like a standard value but isn't, plus one bad record taking down a whole source.** Apple's `TZID=GMT-0500` looks like a zone name and isn't one, so `Intl` threw, and one event's throw emptied the whole family calendar. So check that a field holds the kind of value you assume, and contain failures per record: one bad record should cost that one record and be counted, not take the source with it.

Another (Oct 21): **a value that looks like a time but means something different depending on the machine it runs on.** ical.js turns a time in a zone it wasn't given into a "floating" time, and a floating time is read in the runtime's own zone: Chicago on Clint's Mac, UTC in the Worker. The same code is right in one place and five hours off in the other, so a passing local test proves nothing. Keep the conversion in code whose answer doesn't depend on the machine, and test under the zone production runs in (`TZ=UTC`).

---

## Backlog
- ~~Google Calendar integration~~ — **done** via `/calendar`. The family Apple calendar is live in `CAL_ICS_2` too (2026-10-18).
- ~~Notion church tasks~~ — **done** via `/tasks` (Treasurer tasks card).
- JELC Council numbers (pulled from the JELC Council dashboard, not hand-maintained)
- ~~Daily Bible verse~~ — **done** via `/devotion` (WELS Daily Devotions).
- Personal daily brief alongside the news briefing
- ~~Shorter, punchier briefing summaries~~ — **done**: one or two lines each since the move to `briefing-retrieval` (Oct 2026).
- ~~Decide whether league fill earns its slots~~ — capped at 3, headline-only (Oct 2026). Revisit if the card feels thin.
- Cleaner Worker URL via a `clintsievers.com` subdomain (deliberately deferred)
- ~~git for the Worker~~ — **done**; deployed with wrangler since 2026-10-20 (see The Worker).
- **Bible card:** this Sunday's lectionary readings (JELC follows the lectionary), spread across the week as references only, with no text, so it sends Clint to his Bible. Not the three-year reading plan.
- **Strategy Muse card**, behind the read key: a few lines (next milestones, hours against plan). The tracker is an Apps Script in the Strategy Muse Google account and can serve a minimal summary. The project plan is a Claude.ai artifact the Worker can't read, so it needs a copy that's refreshed whenever a workstream is fleshed out.
- **Check family events on the card after Nov 1.** Rerun the `/calendar` curl on Nov 2 (see Time zones): `sources.icloud` should read `ok (…)`, and any family event with an offset label should show at the time Apple meant. If they're an hour off, the label meant Chicago after all, and the offset decision needs revisiting.
- **Delete the `/sitwith` SEED** in `dashboard-worker/src/index.js` after Oct 21, 2026, once the archive itself covers a full week.
- ~~Restore the Worker's secrets as the newest version~~ — **done** 2026-10-21 (see The Git build outage).
- ~~Replace the calendar parser with ical.js~~ — **done** 2026-10-21 (see The calendar route).
- **`/calendar` is over the Free plan's CPU limit** (see The calendar route, CPU). Every request uses hundreds of ms against a 10 ms limit, and some are killed with error 1102. **Decided 2026-10-21: stay on the Free plan for now** and accept an occasional "unavailable" calendar card. Revisit if it starts failing often enough to matter; the fix then is Workers Paid ($5/month), whose limit is far above what this needs and which would cover every other route too. Smaller savings in code (such as keeping ical.js's time-zone objects between requests) won't get near 10 ms with a 4 MB feed.
- **Orangetheory October comparison** (Phase 1, item 4 of the brief; not yet run, needs the full month): for every class from Oct 1 to the end of manual entry, compare the API's zone minutes, calories, avg/peak HR, steps, tread miles, avg tread speed, rower meters and splats with OTF Class List, and give Clint a short mismatch report. Local and one-time; the report is never committed. Confirms each field means what the Notion field meant before he stops entering by hand.
- **Orangetheory override** for a class the studio recorded wrong: decided not yet (see The Orangetheory card).
- **Confirm `course/` isn't on the live site** once the course PR merges: Settings → Pages should say "Deploy from a branch", and `clints81.github.io/dashboard/course/` (and `/course/00-map.html`) should return 404. If either is served, Pages isn't building with Jekyll and the exclusion needs another approach (see The course).

---

## Design system
Warm light theme. CSS custom properties in `:root` in `index.html`.

- `--bg` / `--bg-2` / `--bg-3` — background layers
- `--ink` / `--ink-2` / `--ink-3` / `--ink-4` — text hierarchy
- `--accent` — warm terracotta `oklch(0.600 0.152 32)`
- `--pos` / `--neg` / `--warn` — status colors

Fonts: Geist (sans), Instrument Serif (display), Geist Mono (mono), via Google Fonts.

Grid: 12-column, `var(--gap)` gutters. Briefing runs 8 wide; devotion/weather/today/teams stack in a 4-column rail; the long-read card spans full width as a divider, with the "Earlier this week" strip at its foot Mon–Sat, or the full-width "Last week's reads" card under it on Sundays. Below "The rest of the morning", Treasurer tasks runs 8 wide beside a 4-wide column holding Orangetheory, then On this day (the workout-thread link is the Orangetheory card's footer). Both sides are sized to their own content (`align-self: start`), not stretched to each other's height. Under 900px everything stacks to full width; under 700px the strip goes to one column.

The rail should end near where the briefing does. It grows with calendar events and sports items, the briefing with story count — when adding a rail card, check both columns at 1194 wide on a full sports day, not just a quiet one.

Installs as a standalone iPad app (11", landscape) via web app manifest + home screen icons. Screenshots for layout work: 1194×834 at deviceScaleFactor 2.
