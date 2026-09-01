# Morning Dashboard — Architecture Reference

Last updated: September 2, 2026

## What this is
A personal morning dashboard for Clint Sievers, hosted on GitHub Pages. Plain HTML/CSS/JS — no framework, no build step. It exists to replace aimless scrolling with a purposeful briefing.

**Live URL:** `https://clints81.github.io/dashboard`
**Repository:** `github.com/clints81/dashboard`
**Worker:** `briefing.clintsievers.workers.dev` (separate — not in the repo)

Repo files:
- `index.html` — structure and design (edit rarely)
- `config.js` — personal data layer (edit regularly, no coding required)
- `app.js` — runtime logic and data fetching (edit for feature changes)
- `DASHBOARD-REFERENCE.md` — this file

---

## The Worker

`briefing.clintsievers.workers.dev` is a Cloudflare Worker Clint owns. It is a single file, edited and deployed through the Cloudflare dashboard editor (not wrangler, not in git — **keep a copy of the source before editing, there is no version history**).

It serves two things:

| Route | Method | What it does |
|---|---|---|
| `/` | GET | Returns the latest briefing JSON from KV (`env.BRIEFING`, key `latest`). CORS `*`. |
| `/` | PUT | Writes briefing JSON to KV. Requires `X-Write-Key` header matching `env.WRITE_KEY`. |
| `/sports` | GET | Fetches, filters, and caches team/league news from RSS. CORS `*`. 20-min cache. |

Write key lives in 1Password and in the briefing skill text. Never in the repo.

### Why a Worker exists at all
The dashboard is served from `clints81.github.io`. Browsers refuse to let a page read a response from another origin unless that origin sends CORS headers saying it's allowed. Notion doesn't. `nytimes.com` doesn't. Server-side fetches aren't subject to that rule, so the Worker fetches on the dashboard's behalf and re-serves the result with `access-control-allow-origin: *`.

This is also why GitHub was abandoned as the delivery route: `git push` and GitHub API writes are both blocked from the Cowork cloud sandbox. Known product gap. Do not revisit.

---

## Data sources

### Live (fetched on page load, and again on foreground/reconnect)
- **Weather** — Open-Meteo (`api.open-meteo.com`), free, no key, CORS-safe. Lat/lon in `config.js`. Hourly + 5-day.
- **Sports** — Worker `/sports` route. See below.
- **On This Day** — Wikipedia `/feed/onthisday/events/{month}/{day}`. 4 events, seeded daily random.
- **Briefing** — Worker root route. Written each morning by the Cowork briefing skill.

All four go through `fetchRetry()` in `app.js`: one retry after 2.5s, and a non-200 is treated as failure rather than parsed as JSON.

### Static (config.js)
- Journal streak, journal prompts (one picked per day by day-of-year), window close time
- Slow burns (names + `lastTouched` day counts)
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
`app.js` takes `teams` first, then fills remaining slots from `league`, then caps at `CONFIG.sports.maxItems` (6). Empty state reads "Nothing on your teams today."

**The cap is the point.** A card that ends is different in kind from a feed. Raising it turns this back into the thing it was built to replace.

Scores are deliberately not shown. ESPN and The Athletic do that better, and scores weren't the reason for opening an app.

---

## The briefing system

Two Cowork skills, cloud-hosted, scheduled:
- **Weekday briefing** — Mon–Fri, 10–12 stories
- **Weekend briefing** — Sat–Sun, 6–8 stories

Pipeline:
1. Read story log from Notion (`33af8d21-7e64-8184-a001-db0a563a70b9`) for fatigue rules
2. Research stories with freshness-first queries
3. Select a "something to sit with" long-read
4. Write HTML email → Gmail draft
5. **Step 8.5** — PUT briefing JSON to the Worker; append "Dashboard write: OK/FAILED" to the email
6. Update the Notion story log

### The two Notion pages are not interchangeable
- `33af8d21…` — **story log**. Read in Step 2, written in Step 10. **Load-bearing.** Deleting either half breaks story fatigue silently: no error, just repeats.
- `367f8d21…` — **dashboard data page**. Written in Step 9. Nothing reads it. Superseded by the Worker; safe to delete.

### Egress allowlist
Cowork has an editable egress allowlist. News source domains get added there. This — not the sandbox — was the real blocker in May 2026. If a fetch fails from Cowork, check the allowlist first.

---

## Current sections

| Section | Source | Notes |
|---|---|---|
| Weather | Open-Meteo | Live; retry + refresh |
| Briefing synthesis + headlines | Worker `/` | Written by skill |
| Something to sit with | Worker `/` | config.js fallback |
| Your teams | Worker `/sports` | Team news, no scores |
| Today's workout | Static link | See below |
| Today (calendar) | Not wired | Scaffolded only |
| Journal nudge | config.js | |
| Slow burns | config.js | |
| On this day | Wikipedia | Live |

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
- Google Calendar integration; Apple Calendar if feasible
- Notion church tasks
- JELC Council numbers (pulled from the JELC Council dashboard, not hand-maintained)
- Daily Bible verse
- Personal daily brief alongside the news briefing
- Shorter, punchier briefing summaries (Step 6 + JSON `summary` field)
- Delete Step 9 from both briefing skills
- Add Step 8.5 to the weekend skill — **check whether this is done**
- Day summary sentence is still static; improves once Calendar is wired
- Decide whether league fill earns its slots, or whether the card should be allowed to go short
- Cleaner Worker URL via a `clintsievers.com` subdomain (deliberately deferred)
- Consider wrangler + git for the Worker once it outgrows one editor screen

---

## Design system
Warm light theme. CSS custom properties in `:root` in `index.html`.

- `--bg` / `--bg-2` / `--bg-3` — background layers
- `--ink` / `--ink-2` / `--ink-3` / `--ink-4` — text hierarchy
- `--accent` — warm terracotta `oklch(0.600 0.152 32)`
- `--pos` / `--neg` / `--warn` — status colors

Fonts: Geist (sans), Instrument Serif (display), Geist Mono (mono), via Google Fonts.

Grid: 12-column, `var(--gap)` gutters. Briefing runs 8 wide; weather/today/teams/workout/on-this-day stack in a 4-column rail; the long-read card spans full width as a divider; Journal and Slow Burns split the band beneath at 6 each.

Installs as a standalone iPad app (11", landscape) via web app manifest + home screen icons. Screenshots for layout work: 1194×834 at deviceScaleFactor 2.
