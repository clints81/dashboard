# Morning briefing: design notes

Why things are the way they are. The README says *what* the Worker does;
this file records the decisions behind it, so they aren't re-argued later.

## The goal

Replace the Cowork tasks (the weekday and weekend briefings, and the
Sunday deep-dive) with a Cloudflare Worker that is cheap, auditable, and
doesn't depend on a cloud sandbox's egress allowlist. Both Cowork
briefing tasks and the deep-dive task were failing by early October 2026.
Built in two phases so each half could be judged alone:

1. **Retrieval** (live 2026-10-04): structured feeds and APIs → dated
   candidate pools in KV. No ranking, no writing.
2. **Judgment** (built 2026-10-06): the Worker sends the pool and the
   story log to the Claude API, verifies what comes back, and publishes.

## Phase 1 decisions (retrieval)

- **Feeds and APIs, not web search.** Every item has a real
  `published_at` from its source. Undated items are counted and dropped,
  never guessed. (Recurring lesson from the dashboard: a field that seems
  to carry meaning often doesn't. Authoritative beats inferred.)
- **Two pools.** `news` = last 36 hours. `sitwith` = rolling 7 days of
  long-form sources, carried forward day to day and capped per source.
- **NYT wins ties.** When two sources carry the same URL, the NYT copy is
  kept. Clint has an NYT subscription.
- **Many small cron ticks.** The free plan allows ~10ms CPU and 50
  fetches per invocation, so a run is spread across 5-minute ticks with
  progress in `run:<date>`. Spare ticks measure sit-with read lengths.
- **The run starts after midnight Central (06:00 UTC).** Editions are
  dated by the Central calendar day, and the dashboard checks the date.
  An earlier start would also miss overnight news. Later is fresher; the
  only limit is finishing before Clint reads (~6am).
- **Separate Worker, separate KV.** Nothing here can break the dashboard
  Worker (`briefing`, KV `briefing-store`).
- **Comparison week.** `/compare` checks whether Cowork's picks were in
  the pool. Cowork keeps running until about 2026-10-11.
- **Open items:** watch The Athletic (it may not earn its place). No
  religion outlet in the news pool. WSJ news (world, US, business, tech,
  economy) was added 2026-10-06; Clint chose not to add Post news.

## Phase 2 decisions (judgment)

### Editions
One prompt (`src/briefing-prompt.md`) ported from the Cowork skills, with
the edition passed in the request so the system prompt never changes.

| | Main section | Also | Sit-with |
|---|---|---|---|
| Weekday | 10–12 fresh stories | | 10–25 min |
| Saturday: the week that was | 5–7 threads from the week | 0–3 fresh stories | 15–40 min |
| Sunday: the week ahead | 5–7 things to watch | 0–3 fresh stories | **the Sunday long read**, 20–40 min |

- **Summaries are one line, two at most.** The dashboard is a scan; the
  3–5 and 6–9 sentence summaries from the email era were cut. Clint found
  Cowork's long summaries not very useful anyway.
- **The synthesis is one or two sentences**: the single thing most worth
  carrying into the day (weekday), what the week added up to (Saturday),
  or what to watch (Sunday).
- **Saturday's recap is built from what Clint was shown**, not from the
  whole week's pools: the Worker's published editions, or Cowork's
  (snapshotted daily as `cowork:<date>`) before cutover. That's ~8k extra
  tokens instead of ~200k. The first Saturday after cutover will be thin.
- **Sunday's look-ahead may only name events a pool item names**, with
  timing as that item states it. The model's own knowledge of upcoming
  events is out of date and would sound confident; a short list is better.
- **Coverage notes** (where outlets differ) appear only on Saturday's
  threads, where differences emerge over a week. Day to day, with these
  sources, they rarely mattered.
- Dashboard labels: `Week · Politics`, `Ahead · Business` (timing leads
  the summary), and weekend fresh stories `New · World`.

### The model judges; the Worker verifies
The model sees items by ID (`N12` news, `S4` sit-with, `W3` this week's
briefings) and never writes a URL. It groups items into stories by
judgment (not keyword overlap; a story with no real match stands alone).
The Worker checks everything and drops what doesn't hold up:

- every cited ID must exist and be allowed in that section (`W` only in
  threads; look-ahead items need pool items and a timing)
- a non-floor fresh story needs at least one item inside 36 hours
- an item backs only one entry in the whole edition (Rule A), and the
  edition's main section claims items first
- the sit-with pick must come from the sit-with pool, must not repeat a
  pick from the last 7 days, and must not be confirmed under 8 minutes
  (20 for the Sunday long read)
- each section is capped at its maximum

**Link choice is the Worker's, not the model's:** if any item behind an
entry is from The New York Times, that's the link.

### Firm floor
One Technology, one Science and one Religion item per edition whenever a
fresh one exists. A recap thread or look-ahead item in the category
counts. Otherwise the model adds a story from the news pool, or from the
7-day sit-with pool if the news pool has none. A pick that made the list
only because of the floor is marked on the dashboard (`Science · floor`).
A category missing without a `none_fresh` report from the model is
recorded at `/brief` as a missed floor rather than filled by the Worker.

### Never pad
The model is told to return fewer items rather than stretch. Under the
main section's minimum, the edition is published as **partial** with a
status sentence ahead of the synthesis (Sunday: "Light week ahead").
If no edition can be produced, a status-only edition goes up so the
dashboard never shows yesterday's briefing as today's.

### Story fatigue and the logs
- Fatigue (Rules A–E) applies to fresh stories only. Recap threads and
  look-ahead items are repeats by design, so they aren't logged; logging
  them would push Monday's stories over the 3-day threshold.
- `storylog` in KV holds the last 7 days and is what fatigue reads.
  Until it holds a full week, missing days come from the Notion story log
  (`33af8d21…`), so fatigue carries across the handover from Cowork.
  A day in neither (in shadow mode, a day Cowork failed and logged
  nothing) comes from the Worker's own edition for that day. Without
  this, shadow editions repeated stories from the day before (found
  2026-10-07: Jim Bakker's death ran two days running).
- Each published edition is **appended** to the Notion story log as a
  readable archive (no longer pruned; its header text saying entries are
  removed after 7 days is now out of date).
- Sit-with picks are logged too: the sit-with pool is a fixed 7-day
  list, so otherwise the same essay could come back within the week.

### The Sunday long read (replaces the Cowork deep-dive task)
Sunday's sit-with pick is the long read: one excellent 20–40 minute
piece, no sports, preferring reported work over opinion. It is checked
against the deep-dive log (`3a2f8d21…`, 28 days) and appended to it in
the same format the Cowork task used. It appears on the dashboard
instead of by email.

Sources added for it (sit-with pool), chosen by Clint:
- **New York** (Intelligencer feed), **Noema**, **Aeon**, **Nautilus**:
  lengths measured by counting page text.
- **WSJ** (Arts & Culture, Lifestyle) and **The Washington Post**
  (Style): neither publishes a long-form feed, so these are their feature
  sections, capped at 12 each. Their pages block length checks, so length
  stays unknown. Clint reads both through Apple News.
- Left out on purpose: 1843, Harper's, MIT Technology Review (no access).

### Same dashboard, no dashboard changes
The Worker PUTs the same JSON shape Cowork did to the dashboard Worker
through the existing service binding (same-account `workers.dev`
fetches fail with error 1042). The dashboard renders `title`, `summary`,
`category` and `synthesis` with `innerHTML`, so the Worker HTML-escapes
those; `sit_with` uses `textContent` and is sent raw.

### Shadow mode until cutover
`PUBLISH` gates every outward write (dashboard, KV story log, both
Notion logs). While it's `off`, editions are saved to `brief:<date>` and
shown at `/brief` only. Running alongside Cowork would mean each
overwriting the other's dashboard JSON, and Cowork's `replace_content`
rewrite of the Notion page folding the Worker's entries into its own
fatigue reads.

Cutover checklist:
1. Turn off both Cowork briefing tasks and the Sunday deep-dive task.
2. Rotate the dashboard write key (the old one sat in the Cowork task's
   text). Generate a new one in 1Password, set it as `WRITE_KEY` on the
   dashboard Worker (Cloudflare dashboard → Workers → briefing →
   Settings → Variables and Secrets), then here:
   `npx wrangler secret put DASHBOARD_WRITE_KEY`. Not before cutover:
   Cowork still writes with the old key until it's switched off.
3. Choose the model (see the comparison below), set `PUBLISH = "on"`,
   deploy.
4. Remove the dashboard's "Retrieval check" card. After cutover
   `/compare` would match the Worker's briefing against its own pool.
5. Next morning, check `/brief` (delivery row) and both Notion pages.

### Cost: Batch API, medium effort
Target: about $5 a month. Clint set it, and the levers were chosen in
this order:

- **Batch API (half price).** One tick submits after the pool is built
  (~1:45am CDT / 12:45am CST); later ticks poll every 5 minutes. Most
  batches finish within an hour; Anthropic only guarantees 24. At 09:30
  UTC (4:30am CDT / 3:30am CST) an unfinished batch is cancelled and the
  request made directly at full price. A status-only edition goes up at
  09:50 if nothing has worked. Cron runs 06:00–09:55 UTC.
- **Batches don't accept `fallbacks`**, so a safety decline in the batch
  also goes to the direct call, which does carry `fallbacks: "default"`.
- **Effort `medium`** (Opus 5.5's default). Thinking is most of the
  output cost.
- **Shorter output**: one-line summaries, no long paragraphs. This
  matters less than the first two (under $1 a month), but the long
  summaries weren't earning their place.
- **Narrower sit-with input**: the model isn't sent pieces measured under
  8 minutes or already recommended. The stored pool is unchanged.
- Rough figures before measurement: ~$5/month on Opus 5.5, ~$2–3 on
  Sonnet 5.5. `/brief` shows each night's tokens and cost.

Other call details: `claude-opus-5-5`, adaptive thinking, JSON output
constrained by one schema for all editions, non-streaming with an
explicit timeout (streaming would cost too much of the free plan's ~10ms
CPU per invocation).

### Opus vs Sonnet comparison
`COMPARE_MODEL` puts a second request in the same batch with the same
input. `/brief/<date>?ab` shows the two side by side; only `MODEL`'s
edition is published or logged. Run it through cutover and judge on:
repeats of stories already seen, whether the floor was filled, whether
cross-outlet groupings are right, and whether the picks are ones Clint
would click. Then set `MODEL` to the winner and clear `COMPARE_MODEL`.

## Keys

All keys are Worker secrets (`wrangler secret put`) or in the
git-ignored `.dev.vars` for local runs. None are in the repo.

| Secret | Used for |
|---|---|
| `NYT_API_KEY`, `GUARDIAN_API_KEY` | retrieval |
| `RUN_KEY` | manual `POST /run` and `POST /judge` |
| `ANTHROPIC_API_KEY` | the judgment call |
| `NOTION_TOKEN` | reading and appending both Notion logs (the integration must be connected to both pages) |
| `DASHBOARD_WRITE_KEY` | PUT to the dashboard Worker (same value the Cowork task used) |
