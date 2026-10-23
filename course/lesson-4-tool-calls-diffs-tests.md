# Lesson 4 · Reading Claude Code at work: tool calls, diffs, test output

*About 10 minutes.*

**Depends on:** `CLAUDE.md`, `briefing-retrieval/src/run.js` (diff example, commit `191755a`), `dashboard-worker/package.json` (`test:calendar`), `dashboard-worker/scripts/calendar-test.mjs`, `DASHBOARD-REFERENCE.md`

*Claude Code's screens look a little different in the terminal, the desktop app and the web app, and they change between versions. This lesson describes the general shape, not exact pixels.*

## The concept

An AI coding agent works in a loop: **look, change, check**, repeat. Each step is a *tool call*, one named action with its inputs, followed by its result. Between calls, the agent writes short notes about what it's thinking.

Following along comes down to one habit: **trust the tool results over the narration.** "The tests pass" is a claim. The test output underneath it is the evidence. Most of what's worth catching shows up as a gap between the two.

## The tools you'll see

| Tool | Shown as, roughly | What it does | Risk |
|---|---|---|---|
| Read | `Read(app.js)` | Opens a file and looks at it | None: looking only |
| Grep / Glob / Search | `Grep("READ_GATE")` | Searches file contents or names | None |
| Bash | `Bash(npm run test:calendar)` | Runs a command in a terminal | Depends entirely on the command (Lesson 6) |
| Edit / Write | `Edit(dashboard-worker/src/index.js)` plus a diff | Changes or creates a file | Changes your files, but nothing is shared or live yet |
| Web fetch / search | `Fetch(https://…)` | Reads a web page | Low, unless the address carries a secret |
| Connector (MCP) tools | names like `mcp__github__create_pull_request` | Acts in another service: GitHub, Notion, Gmail | Can be outward-facing: posts, sends, creates |
| Agent / subagent | `Agent(…)` | Hands a side task to a helper session | Whatever that helper does |

*MCP (Model Context Protocol)* is the plug-in system that connects Claude Code to services like GitHub and Notion. The tool name tells you the service: `mcp__github__…`, `mcp__Notion__…`.

The result of each call usually appears indented underneath it, often trimmed to the first few lines.

### A healthy session in this repo, in order

1. **Read `DASHBOARD-REFERENCE.md`.** Your `CLAUDE.md` makes this the first step before any change. If a session starts editing without it, say so.
2. **Search, then read** the files involved (`Grep`, then `Read`).
3. **Edit**, with a diff for each change.
4. **Check**: `node --check` on every JS file it touched (also required by `CLAUDE.md`), plus any test that covers the area.
5. **Update `DASHBOARD-REFERENCE.md`** in the same change.
6. **Ask before committing.**

## Reading a diff

A diff shows what changed in a file. Here's a real one, from commit `191755a` ("Move the pool deadline from 07:50 to 08:30 UTC"), in `briefing-retrieval/src/run.js`:

```diff
@@ -15,9 +15,10 @@ const MAX_ATTEMPTS = 3;
 const UNITS_PER_TICK = 4;
 const KV_TTL = 60 * 60 * 24 * 45;
 const HISTORY_DAYS = 30;
-// Cron runs every 5 min from 06:00 to 07:55 UTC. Whatever hasn't finished by
-// the last tick gets recorded as failed and the pools are built anyway.
-const LAST_TICK_UTC = { h: 7, m: 50 };
+// Whatever hasn't finished by 08:30 UTC (3:30am CDT / 2:30am CST) is
+// recorded as failed and the pools are built anyway, leaving the rest of the
+// cron window (to 09:55) for the briefing. Most nights finish by ~07:20.
+const LAST_TICK_UTC = { h: 8, m: 30 };
```

How to read it:

- **`@@ -15,9 +15,10 @@`** is the *hunk header*: "this section starts at line 15; it was 9 lines, now 10." The text after it names the nearby code, for orientation.
- **Lines starting with a space** are unchanged context, there to show where you are.
- **`-` lines** (often red) were removed. **`+` lines** (often green) were added.
- **A `-` line next to a similar `+` line** is a modified line. Compare them: here the real change is `{ h: 7, m: 50 }` becoming `{ h: 8, m: 30 }`. Everything else in the hunk is the comment explaining it.
- **Lines starting `//`** (or `#` in `.toml` files) are *comments*: notes for people, which the computer ignores. In your codebase they carry a lot of the reasoning, so a diff that's mostly comments is often mostly explanation.

You don't need to understand the code to ask good questions about a diff. Ask yourself:

1. **Does the size match the request?** A one-number change with 200 lines of diff deserves a "why is this so big?"
2. **Are the files the ones you'd expect?** A calendar fix touching `briefing-retrieval/` would be odd.
3. **Is anything deleted that you didn't ask to remove?** Long runs of `-` with no matching `+`.
4. **Does a value look like a secret?** A long random string being added anywhere. Stop.
5. **Did the matching `DASHBOARD-REFERENCE.md` change come with it?**

## Reading test and check output

### `node --check`: silence is success

`node --check app.js` confirms a file is valid JavaScript without running it. **When it passes, it prints nothing.** When it fails, it prints the file, a line number and a `SyntaxError`. So an empty result under `Bash(node --check app.js)` is good news. A syntax error in `app.js` would stop the whole page from running, every card at once, which is why `CLAUDE.md` makes this check mandatory.

### `npm run test:calendar`: a real test

From `dashboard-worker/`, this feeds a made-up calendar through the Worker's real `/calendar` code and checks each test day. A passing run ends like this (actual output, run while building this course):

```
ok   2026-10-31
ok   2026-11-17
ok   2026-11-20
ok   2026-11-30
ok   2026-12-01
ok   2026-12-31

all 15 days pass
```

A failing day would read `FAIL 2026-11-17` followed by indented `want` and `got` lines: what the test expected and what the code produced. The last line would then be `1 day(s) failed`. When you see `want`/`got`, the gap between them is the bug.

### Exit codes

Every command ends with an *exit code*: 0 means success, anything else means failure. Claude Code's display often notes a non-zero one ("exit code 1", "Error"). The calendar test ends with `process.exit(failed ? 1 : 0)`, so a failure is visible even if the output is trimmed.

### What a test can't tell you

A test checks the cases someone thought to write down, on the machine it runs on. During the October calendar work, it turned out the new parser could give the right times on a Mac set to Chicago and times five hours off in the Worker, which runs on UTC. So the test refuses to run unless `TZ=UTC`, matching the Worker. "Tests pass" means "nothing we anticipated broke." It doesn't mean "it works live".

## What to watch for

- **A claim with no output under it.** "I verified the route works" with no command shown. Ask: "Show me the command and its output."
- **A failing check followed by moving on.** If the output says `FAIL` or `SyntaxError` and the narration says "done", stop and point at the line.
- **Retrying the same failing command** several times with no change. Ask what it thinks is wrong.
- **Edits outside the files you discussed.** Ask why each extra file changed.
- **Work outside this repo.** Tool calls naming other folders or services (Notion, Gmail, GitHub) are outward-facing. Lesson 6.

## Self-check

<details>
<summary>1. Claude Code runs <code>node --check app.js</code> and nothing appears underneath. Did it pass?</summary>

Yes. `node --check` is silent on success and only prints when it finds a syntax error.
</details>

<details>
<summary>2. In the diff above, what actually changed about the program's behavior?</summary>

The deadline moved from 07:50 to 08:30 UTC (3:30am Central in summer). That's the `{ h: 7, m: 50 }` → `{ h: 8, m: 30 }` line. The other changed lines are comments.
</details>

<details>
<summary>3. You asked for a fix to the devotion card. The diff touches <code>dashboard-worker/src/index.js</code> and <code>briefing-retrieval/src/judge.js</code>. What do you ask?</summary>

Why `judge.js` changed. The devotion route lives entirely in `dashboard-worker/src/index.js` (the `DEVOTION` block); `judge.js` is the overnight briefing's checking step and has nothing to do with it.
</details>

<details>
<summary>4. The calendar test prints <code>FAIL 2026-11-20</code> with a <code>want</code> of 9:00 and a <code>got</code> of 10:00. What kind of bug is that likely to be?</summary>

A time-zone bug: an hour off around the November 1 clock change is the classic sign. The test day is a New York third-Friday case "on both sides of Nov 1" (see `DASHBOARD-REFERENCE.md`, Testing).
</details>

<details>
<summary>5. Why can't "the calendar test passed" alone tell you the live calendar card is fine?</summary>

The test uses a made-up feed and only the cases written into it, and it runs on Claude Code's machine, not in Cloudflare. A change also isn't live until it's deployed. Live confirmation means checking the deployed route (its `sources` line) or the card itself.
</details>

Next: [Lesson 5 · Branches to deploys](lesson-5-branches-to-deploys.md)
