# 01 · Glossary

*Layer 1 refresher. Skim it; come back to it when a word stops you.*

**Depends on:** `app.js`, `config.js`, `index.html`, `dashboard-worker/wrangler.toml`, `dashboard-worker/src/index.js`, `dashboard-worker/package.json`, `briefing-retrieval/wrangler.toml`, `.gitignore`, `CLAUDE.md`

Each term gets a plain definition, the general name for it (so it carries over to other projects), and where it shows up in your files.

## The pieces and where they run

**Static site / static host.** A website made of plain files the server hands over unchanged. Your page is one; **GitHub Pages** is the static host. *Where:* `index.html`, `app.js`, `config.js` at the repo root. Live at `clints81.github.io/dashboard`.

**Front end / back end.** The front end runs in your browser (the page). The back end runs on a server somewhere else (the Workers). *Where:* front end is the repo root; back ends are `dashboard-worker/` and `briefing-retrieval/`.

**Worker (Cloudflare Worker).** Cloudflare's name for a *serverless function*: a small program that runs on Cloudflare's machines when a request arrives or a timer fires, with no server for you to manage. *Where:* `dashboard-worker/src/index.js` (named `briefing`), `briefing-retrieval/src/index.js` (named `briefing-retrieval`).

**Proxy.** A go-between that fetches something on your behalf. The `briefing` Worker is a proxy for sports, calendar, Notion and the devotion, because the browser isn't allowed to fetch those itself (see CORS). *Where:* the comment "Why a Worker exists at all" in `DASHBOARD-REFERENCE.md`.

**GitHub Action.** GitHub's *scheduled job / CI runner*: code GitHub runs on its own machines on a schedule or when something happens in a repo. *Where:* only in the private `otf-sync` repo, not this one.

**Cron / scheduled trigger.** A timer written in a compact five-field format. `*/5 6-9 * * *` means "every 5 minutes during hours 6 through 9, UTC". *Where:* `briefing-retrieval/wrangler.toml`, under `[triggers]`.

**UTC.** The world's reference clock, 5 hours ahead of Chicago in summer and 6 in winter. Servers usually run on it, which is why your docs keep translating times. *Where:* comments in both `wrangler.toml` files, and `TZ=UTC` in `dashboard-worker/package.json`.

## Data and storage

**JSON.** A plain-text format for structured data: `{"date": "2026-10-23", "headlines": [...]}`. Everything the Workers send and store is JSON. *Where:* the briefing the page reads in `loadBriefing()` in `app.js`.

**KV (key-value store).** Storage where each item is a value filed under a name, its *key*, like a labeled drawer. (Not the same "key" as a password-like key; context tells you which.) *Where:* `dashboard-worker/wrangler.toml` binds the namespace `BRIEFING`; inside it live `latest` (today's briefing), `sitwith-archive` and `otf-sync`.

**Binding.** A named connection a Worker is given to something else: a KV namespace, another Worker, a variable. The code says `env.BRIEFING`; `wrangler.toml` says what that name points to. *Where:* `[[kv_namespaces]]` and `[[services]]` blocks in both `wrangler.toml` files.

**Service binding.** A binding to another Worker, so one Worker can call another directly. *Where:* `DASHBOARD` and `COWORK` in `briefing-retrieval/wrangler.toml`, both pointing at `briefing`. This is why the `briefing` Worker's name must never change.

**Cache.** A saved copy of an answer, reused for a while so the work isn't redone. *Where:* `CACHE_SECONDS` in each route of `dashboard-worker/src/index.js` (20 minutes for sports, 5 for calendar and tasks, 3 hours for devotion).

**Config file.** Settings kept apart from code so they can change without touching logic. *Where:* `config.js` (the page's settings: location, caps, fallbacks) and `wrangler.toml` (each Worker's settings).

**`sources` block.** Your dashboard's own diagnostic convention: every Worker route reports how each upstream fetch went, like `"google": "ok (212 in file, 3 on 2026-10-18)"`. *Where:* every route in `dashboard-worker/src/index.js`. Lesson 7 leans on it.

## Requests and the web

**Request / response.** The browser (or a Worker) asks; a server answers. Each request has a **method**: `GET` reads, `PUT` writes, `POST` asks the server to do something, `OPTIONS` is the browser checking permission first. *Where:* the router at the bottom of `dashboard-worker/src/index.js`.

**Route / endpoint.** One address on a server that does one job, like `/calendar` or `/otf`. *Where:* the `if (url.pathname === '/sports')` lines in `dashboard-worker/src/index.js`; the table under "The Worker" in `DASHBOARD-REFERENCE.md`.

**Header.** A labeled note attached to a request or response, separate from its body. Your keys travel as headers: `X-Read-Key`, `X-Write-Key`. *Where:* `fetchRetry(url, { headers: { 'X-Read-Key': key } })` in `app.js`.

**Status code.** The three-digit result of a request. `200` OK. `400` your request was malformed. `401` you need a (correct) key. `403` forbidden. `404` not found. `500` the server broke. *Where:* `fetchRetry()` in `app.js` treats anything but 2xx as failure and won't retry a 401.

**CORS (cross-origin resource sharing).** A browser safety rule: a page from one site can only read answers from another site if that site says it's allowed. Notion and nytimes.com don't say so, which is the whole reason the `briefing` Worker exists. *Where:* `"Access-Control-Allow-Origin": "*"` in `dashboard-worker/src/index.js`.

**API.** A service's front door for programs rather than people. *Where:* Open-Meteo in `loadWeather()`, the Notion and Claude APIs inside the Workers.

**RSS / feed.** A machine-readable list of a site's latest items. *Where:* the sports feeds and the WELS devotion feed in `dashboard-worker/src/index.js`; the news sources in `briefing-retrieval/src/sources.js`.

**localStorage.** A small storage area in one browser on one device, kept between visits. *Where:* `localStorage.getItem('dashReadKey')` in `app.js`; it's where each device keeps the read key.

## Security

**Secret.** A value that grants access and must never be published: a key, token or password. *Where:* never in the repo. Listed by name only in the comments at the bottom of each `wrangler.toml`.

**Read key / write key.** Your two dashboard keys. The read key lets a device see the three private routes; the write key lets a program change what's stored. Lesson 3 covers both.

**Token.** A secret issued by a service (Notion, Anthropic) that lets a program act as you there. *Where:* `NOTION_TOKEN`, `ANTHROPIC_API_KEY` named in `briefing-retrieval/wrangler.toml`.

**`.gitignore`.** A list of files git should pretend aren't there, so they can never be committed. *Where:* `.gitignore` at the root (keeps out `briefs/`) and in each Worker folder (keeps out `.dev.vars`, local secret files).

**Rotate.** Replace a secret with a new value and update everywhere that uses it, usually because the old one may have leaked.

## Changing code

**Repository (repo).** The project folder plus its full history. Yours is `github.com/clints81/dashboard`, and it's **public**.

**Commit.** A saved snapshot of changes with a message saying what and why. *Where:* `git log` shows them; your `CLAUDE.md` says Claude Code must ask before committing.

**Branch.** A separate line of commits, so work can happen without touching `main`. *Where:* this course was built on `claude/gracious-ride-y00dto`.

**`main`.** The branch that counts. GitHub Pages publishes from it.

**Push.** Send commits from the machine Claude Code is on up to GitHub. Before a push, the commits exist only locally.

**Pull request (PR).** A proposal on GitHub to merge one branch into another, with the diff and a place to discuss it.

**Merge.** Fold a branch's commits into another branch. Merging into `main` publishes the page.

**Diff.** The difference between two versions of a file: removed lines marked `-`, added lines `+`. Lesson 4 teaches you to read one.

**Deploy.** Make a new version live. For the page, merging to `main` deploys. For a Worker, `npm run deploy` (which runs `wrangler deploy`) does. *Where:* `"deploy": "wrangler deploy"` in each Worker's `package.json`.

**wrangler.** Cloudflare's command-line tool for Workers: deploys, secrets, rollbacks, live logs (`wrangler tail`). *Where:* `devDependencies` in each Worker's `package.json`.

**Version / rollback.** Every Worker deploy creates a version; a rollback makes an older version live again. *Where:* "The Git build outage" in `DASHBOARD-REFERENCE.md`.

**npm / package / dependency.** npm installs other people's code (packages) your code depends on. `package.json` lists them; `package-lock.json` pins exact versions. *Where:* `ical.js` in `dashboard-worker/package.json`, pinned to `2.2.1`.

**Syntax check.** Checking that a file is valid code without running it. *Where:* `node --check` on every JS file, required by `CLAUDE.md`.

**Test.** A script that runs code against known inputs and checks the outputs. *Where:* `npm run test:calendar` runs `dashboard-worker/scripts/calendar-test.mjs`.

**Dry run.** Doing everything except the part with consequences. *Where:* `npm run dry-run` in both Worker folders.

## Claude Code words

**Tool call.** One action Claude Code takes: read a file, search, run a command, edit a file. Lesson 4.

**Approval prompt / permission prompt.** Claude Code pausing to ask before an action. Lesson 6.

**`CLAUDE.md`.** Standing instructions Claude Code reads at the start of every session in this repo. *Where:* `CLAUDE.md` at the root.

**Brief.** Your planning chat's written instructions for a change. *Where:* `briefs/`, gitignored, never committed.

**Session / context.** One Claude Code conversation and what it currently remembers. A new session starts from `CLAUDE.md` and the files, not from your last conversation.

Next: [Lesson 1 · What runs where](lesson-1-what-runs-where.md)
