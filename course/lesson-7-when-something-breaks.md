# Lesson 7 · When something breaks

*About 12 minutes.*

**Depends on:** `app.js` (`fetchRetry`, `renderLocked`, each `load…` function's error branch), `dashboard-worker/src/index.js` (each route's `sources` block, `READ_GATE`), `briefing-retrieval/src/judge.js` (`failureEdition`, status lines), `briefing-retrieval/README.md` (endpoints), `DASHBOARD-REFERENCE.md` (every route section, The Git build outage, Recurring lesson, Backlog)

## The concept

Debugging is narrowing down. You won't fix code, but you can do the first, most valuable step: turn "the dashboard's broken" into "this card, since this time, saying this, probably in this place." That makes Claude Code's job a lookup instead of a search, and it keeps it from "fixing" the wrong thing.

Your dashboard makes this unusually easy, because it was built on one rule: **a failure must never look like a quiet day.** Every card has a distinct broken state, and every Worker route reports a `sources` block saying how each upstream fetch went. So the evidence usually already exists. You just have to ask for it.

## The four questions, in order

1. **How wide?** One card? Every card that goes through the Worker? Every card, including weather? Only on one device? The width points to the place:
   - *One card*: that card's route or source.
   - *All Worker cards, but weather and On this day fine*: the `briefing` Worker itself.
   - *Everything, even weather*: the page (`app.js`) or the iPad's connection.
   - *One device only*: that device (its stored key, or a stale copy of the page).
2. **What exactly does it say?** "Locked", "Key rejected", "unavailable", "No briefing yet today", "Partial edition", "Not updated since…". Each phrase comes from one specific branch of code.
3. **Since when, and what changed just before?** A merge? A deploy? A key rotation? The first of a month? The clock change on Nov 1?
4. **What does the evidence say?** The route's `sources` block, the `/brief` page, the otf-sync run log.

Then write the question with all four in it.

## Symptom → likely location → a good question

| You see | Likely place | Ask Claude Code |
|---|---|---|
| **Everything blank**, even weather and the clock | The page: a syntax error in `app.js`, or the iPad is offline | "Did a change to `app.js` merge recently? Does `node --check app.js` pass on `main`?" |
| **Weather and On this day fine, every Worker card failing** | The `briefing` Worker: a bad deploy or missing binding (Oct 20) | "What version of the `briefing` Worker is live and when was it deployed? Does `GET /` return briefing JSON?" |
| **"Locked on this device"** on one device | That device has no read key stored. Not a fault. | Nothing. Tap Enter key and paste from 1Password. |
| **"Key rejected"** on calendar, tasks and Orangetheory | `READ_KEY` changed (rotation, `secret put`) or the device has an old key | "Was `READ_KEY` changed recently? Which version is live?" |
| **Calendar, tasks and Orangetheory all "unavailable"** at once | The Worker may be refusing with 500 `READ_KEY unset` (fails closed) | "Run `wrangler secret list` for `briefing`. Are all five secrets there?" |
| **"Calendar unavailable"** now and then, fine on reload | Known: `/calendar` exceeds the Free plan's CPU limit and is sometimes killed (error 1102). Accepted on Oct 21. | Only if it's frequent: "How often is `/calendar` hitting 1102 this week, from `wrangler tail`?" |
| **An event an hour off** | Calendar time zones (`resolveZone()`, `wallToUTC()`), especially after Nov 1 | "Which `TZID` does that event use? Is it one of the `GMT±HHMM` labels the backlog says to check after Nov 1?" |
| **An event missing or on the wrong day** | Calendar recurrence or a skipped event | "What does `sources` say for that feed on that date (`?date=YYYY-MM-DD`)? Is the `skipped` count non-zero?" |
| **Family events gone, Google's fine** | The iCloud feed (`CAL_ICS_2`) | "What does `sources.icloud` say? `HTTP 4xx` would mean the share link changed." |
| **"No briefing yet today. Showing Thursday's."** | `briefing-retrieval` didn't deliver tonight's | "What does today's `/brief` page show in its Delivery row?" |
| **"No briefing this morning. …"** | The overnight run failed but reported it (`failureEdition()`) | "Which step failed: the pool or the Claude call? What does `/status` show?" |
| **"Partial edition: N stories…"** | `verify()` dropped stories | "What's in the Dropped / fixed row on today's `/brief` page?" |
| **A story or summary that's wrong** | Claude's wording, or a bad pool item | "Which pool items sat behind that story on `/brief`?" |
| **A team missing from sports** | One feed blocked, or genuinely a quiet day | "What does the `/sports` `sources` block say for that team's feed?" |
| **Tasks "unavailable"** | Notion (`sources.notion`) | "Is it `HTTP 401` (token) or `HTTP 404` (the connection lost access to the database)?" |
| **Devotion "unavailable"** | The WELS feed (`sources.wels`) | "Is it `parse-miss`? Did WELS change its template?" |
| **Orangetheory "sync failed" or "Not updated since…"** | otf-sync, in the **other repo** | "What did the last otf-sync Actions run report for `login` and `workouts`?" (needs a session on `otf-sync`) |
| **Orangetheory "Partial: …"** | otf-sync's `parse` check: a class it couldn't read | "What's in `sources.parse` and `new_class_types`?" |
| **"No monthly post for November yet."** | Not a fault. The month's Notion row is missing. | Nothing: add the row in "OTF Monthly Posts" and paste the post. |
| **"Archive unavailable"** under the sit-with card | The sit-with archive in KV | "What does `/sitwith` report in `sources.archive`?" |
| **A merged change isn't showing** | iPad showing an old copy, or a Worker change that was never deployed | First force-quit the app. Then: "Was this a Worker change, and was it deployed?" |

## Past incidents, as patterns

The Recurring lesson section of `DASHBOARD-REFERENCE.md` collects these. Each is a pattern you'll meet again in other projects.

**One bad record took down a whole source (Oct 18).** Apple wrote some events with a time zone labeled `GMT-0500`. That looks like a zone name but isn't one, so the code threw an error, and one event's error emptied the entire family calendar. The fix handled the label, and also changed the rule: one bad event now costs only that event, counted in `skipped`. *Pattern: when a whole source vanishes, suspect one malformed item.*

**A deploy path nobody remembered (Oct 20).** Covered in Lesson 5. *Pattern: when everything behind one server fails at once, ask what was deployed, and how.*

**Right on one machine, wrong on another (caught Oct 21, before deploying).** The new calendar parser gave correct times on a Mac set to Chicago and times five hours off on a Worker running UTC. *Pattern: "it works on my machine" means check what's different about the machine. Time zone is the usual suspect.*

**A field that didn't mean what it seemed.** Reddit's timestamps recorded when a bot posted, not which day the thread was for. A cached answer looked identical to a fresh one. A failed fetch looked like a quiet news day. *Pattern: before trusting a value, ask whether it really carries the meaning you assume.*

## Writing the question

A weak question: "The calendar's broken, can you fix it?"

A strong one: "Since this morning the family events are missing from the calendar card; Google's are fine, and it's the same on the iPad and the laptop. Nothing was deployed yesterday. Can you fetch `/calendar` (key through stdin) and show me `sources.icloud`? I'm guessing the Apple share link stopped working."

It names the scope, the timing, what changed (nothing), the evidence you want, and a hypothesis. A hypothesis that turns out wrong is still useful: it gives Claude Code something specific to confirm or rule out, and keeps it from rewriting the parser to fix a dead link.

Two more habits:
- **Ask for evidence before a fix.** "Show me what's failing before changing anything" keeps a misdiagnosis from turning into a commit.
- **Ask what a fix will be checked against.** "How will we know it's fixed?" should name a route, a `sources` line or a test.

## Self-check

<details>
<summary>1. Weather and On this day load, but the briefing, sports, calendar, tasks, devotion and Orangetheory all fail. Where do you look first?</summary>

At the `briefing` Worker as a whole, not any single route: those six all go through it, and the two that work don't. Ask what version is live and when it was deployed. This is the Oct 20 shape.
</details>

<details>
<summary>2. The briefing says "No briefing yet today. Showing Thursday's." on Friday morning. Which piece most likely failed, and where's the evidence?</summary>

`briefing-retrieval` didn't deliver Friday's edition to the `briefing` Worker. The evidence is at `briefing-retrieval.clintsievers.workers.dev/brief` (its Delivery row says whether the PUT to the dashboard worked) and `/status` (the pool run). The page is working correctly: it noticed the stored briefing's date isn't today.
</details>

<details>
<summary>3. Tasks says "unavailable" and <code>sources.notion</code> reads <code>HTTP 404</code>. What's the likely cause?</summary>

The Notion connection lost access to the treasurer database. Notion reports missing permission as "not found". The fix is in Notion (database → ••• → Connections), not in code.
</details>

<details>
<summary>4. On Nov 2, a family event shows at 9:00 when you know it's at 10:00. What's your hypothesis, and what do you ask?</summary>

It's probably a time-zone label (like `GMT-0500`) that Apple meant as Chicago time. The backlog has exactly this check for after Nov 1. Ask: "Which `TZID` does that event use? Is it an offset label?" If it is, the decision to trust the stated offset needs revisiting.
</details>

<details>
<summary>5. Only your laptop says "Key rejected"; the iPad's calendar loads. What's going on?</summary>

The laptop has an old or mistyped read key in its browser storage. The Worker is fine, since the iPad's key works. Re-enter the key on the laptop from 1Password.
</details>

Back to the [course index](README.md).
