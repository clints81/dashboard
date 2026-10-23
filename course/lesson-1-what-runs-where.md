# Lesson 1 · What runs where, and in what order

*About 10 minutes.*

**Depends on:** `index.html`, `app.js`, `dashboard-worker/src/index.js`, `dashboard-worker/wrangler.toml`, `briefing-retrieval/src/index.js`, `briefing-retrieval/src/judge.js`, `briefing-retrieval/wrangler.toml`, `DASHBOARD-REFERENCE.md` (The Worker, The briefing system, otf-sync)

## The concept

Almost every modern web project splits into the same few kinds of places, and yours is a clean example:

- **Something in the browser** that draws what you see. It can only do what browsers allow.
- **Something on a server** that does what the browser can't: hold secrets, fetch from sites that don't allow browsers, store data.
- **Something on a timer** that does work while nobody's looking.
- **Outside services** each of those borrows from.

When something's wrong, the first question is always *which place*. Each place has its own logs, its own way of going live, and its own failure modes, so knowing the place cuts the search down to one folder.

Your four places:

| General kind | Yours | Folder | Triggered by |
|---|---|---|---|
| Static front end | The page | repo root | You opening the app |
| Serverless back end | `briefing` Worker | `dashboard-worker/` | A request arriving |
| Scheduled serverless job | `briefing-retrieval` Worker | `briefing-retrieval/` | A cron timer (and requests, for its own pages) |
| Scheduled CI job | otf-sync | private repo, **not here** | A GitHub Actions schedule |

## Where it lives in your files

### The page: three files, loaded in order

The bottom of `index.html` loads the settings first, then the logic that uses them:

```html
<script src="config.js"></script>
<script src="app.js"></script>
```

That order matters. `app.js` reads `CONFIG`, which only exists once `config.js` has run. If Claude Code ever swaps these lines, every card breaks.

When the page starts, `app.js` kicks off every card at once:

```js
// Cards that depend on the network. Safe to call again at any time.
function loadLiveData() {
  loadWeather();
  loadSports();
  loadCalendar();
  loadTasks();
  loadOtf();
  loadDevotion();
  loadOnThisDay();
  loadBriefing(); // handles both briefing and sit-with
  loadSitArchive();
}
```

None of these waits for the others. That's why cards fill in at slightly different moments, and why one failing card doesn't hold up the rest. The same function runs again whenever the app returns to the foreground (at most once a minute) or the iPad reconnects. On an iPad that keeps the app open for days, a 6am network blip would otherwise leave a card broken until lunch.

### The `briefing` Worker: one switchboard

The bottom of `dashboard-worker/src/index.js` is a *router*: it looks at the address of each request and hands it to the matching block of code.

```js
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/sports') return handleSports(request, ctx);
    if (url.pathname === '/calendar') return CALENDAR.handle(request, env);
    if (url.pathname === '/tasks') return TASKS.handle(request, env);
    if (url.pathname === '/devotion') return DEVOTION.handle(request);
    if (url.pathname === '/sitwith') return SITWITH.handle(request, env);
    if (url.pathname === '/otf') return OTF.handle(request, env);
```

Anything that isn't one of those falls through to the root route `/`: `GET` returns today's briefing from storage, `PUT` stores a new one. `fetch` here means "a request arrived". Your Workers only run when something calls them or a timer fires; between calls they don't exist.

### The `briefing-retrieval` Worker: a timer and a handoff

Its timer is in `briefing-retrieval/wrangler.toml`:

```toml
# Every 5 minutes, 06:00–09:55 UTC (1:00–4:55am CDT; 12:00–3:55am CST).
...
crons = ["*/5 6-9 * * *", "0 12 * * *"]
```

Each wake-up does a small slice of work and saves its progress, because the free plan allows only about 10 milliseconds of computing per run. When the pool is built, later wake-ups send it to Claude and collect the answer. The handoff to the dashboard is in `briefing-retrieval/src/judge.js`:

```js
async function putDashboard(env, body) {
  if (!env.DASHBOARD_WRITE_KEY) throw new Error('missing DASHBOARD_WRITE_KEY');
  const req = new Request(DASHBOARD_URL, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-write-key': env.DASHBOARD_WRITE_KEY },
    body: JSON.stringify(body),
  });
  // Same-account workers.dev fetches fail (error 1042), so production goes
  // through the service binding.
  const r = await (env.DASHBOARD ? env.DASHBOARD.fetch(req) : fetch(req));
```

In plain English: build a `PUT` request carrying the write key and the briefing, and send it through the `DASHBOARD` *service binding* (a direct line to the `briefing` Worker). Cloudflare won't let one of your Workers call another by its public address, so the binding is the only way through. That's also why the `briefing` Worker's name can never change: the binding finds it by name.

### otf-sync: the piece you can't see here

otf-sync is Python code in the private repo `clints81/otf-sync`, run by GitHub Actions at 3:40am, 10:40am and 6:40pm Central. It's private because Action logs in a public repo are public, and its runs handle your Orangetheory login. From this repo you can only see its landing spot, the `/otf` route in `dashboard-worker/src/index.js`. If the Orangetheory card says the sync failed, the answer is in that other repo's Actions tab, not here.

## The order, start to finish

```
1:00am   briefing-retrieval starts building the pool (every 5 min)
~2:30    pool ready → sent to Claude as a batch
~2:40    answer back → checked → PUT to briefing Worker (`latest`)
         → story log to KV and Notion
3:30     deadline: any source not finished is marked failed, pool built anyway
3:40     otf-sync → PUT /otf
4:30     if the batch still isn't back: ask Claude directly, full price
~6:00    you open the iPad → page loads → 9 requests in parallel
7:00     briefing-retrieval's second timer (a leftover snapshot job)
all day  page re-asks on foreground / reconnect
```

Daylight saving times shown; in winter everything on a UTC timer happens an hour earlier by the clock on your wall.

## What it looks like when Claude Code is working on it

The folder Claude Code touches tells you which place is changing:

- **Edits to `app.js`, `index.html` or `config.js`**: the page. It goes live when it reaches `main`. Claude Code may offer to run a local preview server (`python3 -m http.server 8765`, from `.claude/launch.json`) and take screenshots at iPad size.
- **Edits under `dashboard-worker/`**: the `briefing` Worker. You should expect, at the end, a step that runs `npm run deploy` from that folder. If Claude Code says "done" without a deploy, the change isn't live yet.
- **Edits under `briefing-retrieval/`**: the overnight job. Same deploy rule, and you won't see the effect until the next night's run (or a manual `POST /judge`).
- **Edits to a `wrangler.toml`**: the Worker's settings, not its code. Lesson 6 treats these as high-stakes, because a deploy removes any setting not in the file.
- **Anything about otf-sync**: Claude Code in this repo can't see or change it. It needs a session on the `otf-sync` repo.

## Self-check

<details>
<summary>1. You change the weather card's layout in <code>app.js</code> and merge the PR. What else has to happen before you see it on the iPad?</summary>

Nothing on the server side: GitHub Pages republishes when `main` changes, usually within a minute or two. On the iPad itself, the standalone app may keep serving the old copy, so force-quit and reopen it (noted under Refresh behavior in `DASHBOARD-REFERENCE.md`).
</details>

<details>
<summary>2. Which two cards don't go through the <code>briefing</code> Worker at all, and why can they skip it?</summary>

Weather (Open-Meteo) and On this day (Wikipedia). Both services allow browsers to read them directly (they send CORS headers) and need no secret, so there's nothing for a proxy to add. That's also why they kept working during the October 20 outage when every Worker card failed.
</details>

<details>
<summary>3. The briefing arrives at the <code>briefing</code> Worker through a "service binding" called <code>DASHBOARD</code>. What would break if someone renamed the <code>briefing</code> Worker in Cloudflare?</summary>

The binding finds the Worker by name, so `briefing-retrieval` could no longer deliver the overnight briefing (and its `/compare` page couldn't read it). The page would also break, since `app.js` calls `briefing.clintsievers.workers.dev` by name.
</details>

<details>
<summary>4. The Orangetheory card says the sync failed at 3:40am. Where is the code that failed, and can Claude Code in this repo fix it?</summary>

In the private `clints81/otf-sync` repo, run by GitHub Actions. Claude Code in this repo can only see where its data lands (`/otf` in `dashboard-worker/src/index.js`). To fix the sync itself you'd open a session on `otf-sync` and start from that run's log in its Actions tab.
</details>

<details>
<summary>5. Why does <code>briefing-retrieval</code> wake up every 5 minutes for four hours instead of running once?</summary>

The Workers Free plan gives each run about 10 ms of computing time and 50 fetches. Building the pool takes far more, so the work is split across many short runs, each saving its progress in KV (`run:<date>`) for the next to pick up.
</details>

Next: [Lesson 2 · Fetched vs. generated](lesson-2-fetched-vs-generated.md)
