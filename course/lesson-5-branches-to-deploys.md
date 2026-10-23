# Lesson 5 · Reading Claude Code at work: branches to deploys

*About 10 minutes.*

**Depends on:** `CLAUDE.md`, `.gitignore`, `_config.yml`, `dashboard-worker/package.json`, `dashboard-worker/wrangler.toml`, `briefing-retrieval/package.json`, `DASHBOARD-REFERENCE.md` (The Worker, The Git build outage, Refresh behavior)

## The concept

A change climbs a ladder, and each rung is a separate step with its own command. Most confusion about "is it done?" comes down to not knowing which rung a change is on.

| Rung | What it means | Command you'll see | Who can see it |
|---|---|---|---|
| 1. Edited | Files changed on the machine Claude Code is using | Edit / Write tool calls | Only that machine |
| 2. Committed | Saved as a named snapshot in the local history | `git commit -m "…"` | Only that machine |
| 3. Pushed | Copied up to GitHub, on a branch | `git push -u origin <branch>` | Anyone who can see the repo (yours is public) |
| 4. Proposed | A pull request asks to merge the branch into `main` | creating a PR (often a `mcp__github__…` tool) | Same, plus a review page |
| 5. Merged | The branch's commits are now part of `main` | the Merge button on GitHub, or `git merge` | Same |
| 6. Live | Running for real | **depends on the piece** (below) | You, on the iPad |

**Rung 6 is different for each piece**, and that's the most important thing in this lesson:

- **The page**: merging to `main` *is* the deploy. GitHub Pages republishes the repo root automatically, usually within a couple of minutes. (Except `course/`, which `_config.yml` keeps off the site.)
- **Both Workers**: merging does nothing to what's live. A Worker changes only when someone runs `npm run deploy` from its folder, which runs `wrangler deploy` and uploads it to Cloudflare. Until then, Cloudflare keeps running the last version deployed, no matter what `main` says.

So `main` can be ahead of a live Worker. That's by design (see the outage below), but it means "merged" never means "live" for anything under `dashboard-worker/` or `briefing-retrieval/`.

## Where it lives in your files

**The deploy command** is a one-line script in each Worker's `package.json`:

```json
  "scripts": {
    "deploy": "wrangler deploy",
    "dry-run": "wrangler deploy --dry-run",
    "tail": "wrangler tail",
    "test:calendar": "TZ=UTC node scripts/calendar-test.mjs"
  },
```

`npm run deploy` just runs `wrangler deploy`. `dry-run` builds everything without uploading. `tail` streams the live Worker's logs.

**What a deploy uploads** is the code plus `wrangler.toml`, and that file is treated as the *complete* list of settings:

```toml
# This file is the whole config: a deploy removes any binding, variable or
# trigger that isn't here. Don't change settings in the Cloudflare dashboard.
```

Secrets are the exception: they aren't in the file, and they carry over from the newest version.

**Your git rules** are in `CLAUDE.md`: "Never commit without asking; Clint reviews and approves changes." And `briefs/` is in `.gitignore`, so a brief can't be committed by accident.

## The worked example: the Git build outage (Oct 20–21)

This one incident teaches nearly the whole ladder.

Until October 20 the `briefing` Worker was also wired to this GitHub repo through Cloudflare's "Git builds": every push to `main` triggered an automatic deploy. Nobody remembered that setting. At 5:46pm on the 20th, the change that moved the Worker's code into `dashboard-worker/` was pushed to `main`. Cloudflare's automatic build ran at the repo root, found no Worker there, decided the repo was a plain static website, and deployed *that* as the `briefing` Worker: no code, no storage binding, no secrets. Every Worker card failed overnight. Weather and On this day kept working, since they don't use the Worker.

The next morning you rolled back to the last good version (`4596e16b`) and turned Git builds off. Since then: **deploys are a deliberate `npm run deploy`, never automatic.** Otherwise every commit, even one that only edits documentation, would go live.

There was a second trap. A rollback makes an old version *live*, but it doesn't make it the *newest*. `wrangler deploy` copies secrets from the newest version, which was still the broken static one, with no secrets. A plain `npm run deploy` the next day would have taken the dashboard down again. It was caught by checking `wrangler secret list` (it came back empty while the live Worker had all five) and fixed by re-entering the secrets on a new version before deploying. The standing rule: **after any rollback, check `wrangler secret list` before the next deploy.**

General lessons that carry over:
- Know every path by which code can go live, including ones a dashboard setting turned on.
- "Merged" and "deployed" should be separate decisions for anything that holds secrets or data.
- A rollback is an emergency brake, not an undo. Check the state afterwards.

## Other wrangler steps you'll see

| Command | What it does | Live? |
|---|---|---|
| `npx wrangler versions upload` | Uploads a new version *without* making it live, and gives it a preview address to test | No |
| `npx wrangler versions deploy <id>@100%` | Makes a specific uploaded version live for all traffic | **Yes** |
| `npx wrangler rollback` | Makes the previous version live again | **Yes** |
| `npx wrangler secret list` | Lists secret names | No |
| `npx wrangler secret put <NAME>` | Sets a secret and deploys a new version with it | **Yes** |
| `npx wrangler tail` | Streams live logs | No |

The calendar parser went live on Oct 21 the careful way: upload a version, compare its preview address against live for 92 days of dates, then deploy that exact version.

## What it looks like when Claude Code is working on it

- **`git status`** lists changed files; **`git diff`** shows the changes; **`git log`** lists commits. All read-only.
- **`git checkout -b <name>`** or **`git switch -c <name>`** creates a branch. Harmless.
- **`git add`** then **`git commit -m "…"`** saves a snapshot. Your repo's commit messages follow a pattern: a short imperative subject ("Add the Orangetheory card and the /otf Worker route"), then a body explaining *why*.
- **`git push -u origin <branch>`** publishes the branch to GitHub. Since your repo is public, this is the moment the change becomes visible to the world. It's also the moment the work survives: a cloud session's machine is temporary and gets wiped when the session ends, so unpushed work is lost.
- **Merging** is your step, on the pull request page.
- **`npm run deploy`** (or `wrangler deploy`) from a Worker folder is the step that goes live. It needs to run somewhere logged in to your Cloudflare account. A cloud session usually isn't, so Claude Code may hand this step to you or to a session on your Mac.

On the iPad: after a page change merges, the standalone app may keep showing the old version. Force-quit and reopen it before deciding the change didn't work.

## Self-check

<details>
<summary>1. Claude Code says "Fixed the sports filter and committed it." Can you see the fix on the iPad?</summary>

No. Committed is rung 2: only on Claude Code's machine. The sports filter lives in `dashboard-worker/src/index.js`, so it also needs pushing, merging and then `npm run deploy` from `dashboard-worker/`.
</details>

<details>
<summary>2. A PR changing only <code>app.js</code> is merged. A PR changing only <code>dashboard-worker/src/index.js</code> is merged. Which one is live?</summary>

The `app.js` one: GitHub Pages republishes when `main` changes. The Worker change isn't live until someone runs `npm run deploy` from `dashboard-worker/`.
</details>

<details>
<summary>3. Why were Cloudflare's automatic Git builds turned off rather than fixed?</summary>

Because you want deploys to be a deliberate act. With builds on push, every commit to `main` goes live, documentation-only ones included, and a mistake in how the build runs (as on Oct 20) takes the Worker down without anyone pressing deploy.
</details>

<details>
<summary>4. You just rolled back the <code>briefing</code> Worker. What should happen before the next <code>npm run deploy</code>?</summary>

Run `npx wrangler secret list` and confirm all five secrets are listed. The newest version may not be the live one, and a deploy copies secrets from the newest. If the list is short, re-enter the secrets on a new version first.
</details>

<details>
<summary>5. Claude Code wants to run <code>git push</code> in a cloud session. What does approving do, and what happens to the work if you don't push before the session ends?</summary>

Approving copies the commits to the branch on GitHub, where anyone can see them, since the repo is public. Nothing goes live yet. If you never push, the commits exist only on the session's temporary machine and are lost when it's cleaned up.
</details>

Next: [Lesson 6 · Approval prompts](lesson-6-approval-prompts.md)
