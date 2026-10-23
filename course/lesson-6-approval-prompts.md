# Lesson 6 · Approval prompts

*About 12 minutes. The most practical lesson in the course.*

**Depends on:** `CLAUDE.md`, `.gitignore`, `dashboard-worker/wrangler.toml`, `briefing-retrieval/wrangler.toml`, `dashboard-worker/package.json`, `briefing-retrieval/package.json`, `briefing-retrieval/src/judge.js` (`verify`), `DASHBOARD-REFERENCE.md` (Read key, The Worker, The Git build outage)

*The exact wording and buttons differ between the terminal, desktop app and web app, and change between versions. What follows is the general shape, which stays stable.*

## The concept

An approval prompt is the agent stopping to say "I'm about to do this; OK?" How often it asks depends on its *permission mode*. In a cautious mode it asks before most edits and commands; in more automatic modes it asks only for things judged risky, or not at all. Either way, each prompt is a decision only you can make, and the cost of approving blind depends entirely on what's being asked.

Most prompts offer three kinds of answer:

1. **Yes**: do this one thing.
2. **Yes, and don't ask again** for this kind of thing: in this session, for this folder, or for commands starting with the same words. **This is the riskiest button**, because it turns one decision into a standing rule. "Don't ask again for `npx wrangler` commands" would cover `wrangler secret list` (harmless) and `wrangler deploy` (live) alike.
3. **No, and tell Claude what to do differently**: stop and type a question or instruction. This isn't a rejection of the work. It's how you ask a question before anything happens.

## Five questions for any prompt

You can judge nearly any prompt without reading code by asking:

1. **What will it touch?** Local files, GitHub, Cloudflare, Notion, someone's inbox?
2. **Can it be undone?** An edit can be reverted. A push to a public repo, a sent email or a leaked key can't be fully taken back.
3. **Who else will see it?** Only this machine, or the public, or another person?
4. **Does it spend money?** Claude API calls, paid plans.
5. **Does it carry a secret?** In a command line, a file, a URL, the chat.

If you can't answer one of these from the prompt, that's the question to type back.

## Quick triage

| Usually fine to approve | Look before you approve | Stop and ask first |
|---|---|---|
| Reading and searching files | Editing files (read the diff) | Anything with a secret value visible |
| `git status`, `git diff`, `git log` | `git commit` | `git push --force`, `git reset --hard`, deleting branches |
| `node --check`, `npm run test:calendar` | `git push` to the working branch | `wrangler deploy`, `versions deploy`, `rollback` |
| `npm run dry-run` (dashboard Worker) | `npm install` / `npm ci` | `wrangler secret put` |
| `wrangler secret list`, `wrangler tail` | Opening a pull request | Merging a PR, or any push to `main` |
| | Fetching a public web page | Editing either `wrangler.toml` |
| | | Calls that spend money (`judge-dry-run`, `POST /judge`) |
| | | Sending, posting or deleting in Gmail, Notion, Calendar |
| | | Anything touching `briefs/` and git together |

## Each kind of prompt

### 1. File edits and new files

**What it's asking:** "Can I change this file?" with a diff shown.

**Check:** Is it a file you expected (Lesson 4's diff questions)? Is the change about the size you'd expect? For this repo, does `DASHBOARD-REFERENCE.md` get its matching update before the commit?

**Stop and ask if:** the file is `wrangler.toml`, `CLAUDE.md`, `.gitignore` or `_config.yml` and you didn't discuss changing settings; a long random string is being added; a lot of `-` lines appear with no explanation; or a file is being created inside `briefs/` with a plan to commit it.

**Why `wrangler.toml` is special:** a deploy removes any binding, variable or trigger not listed in it. Deleting a line there and deploying deletes that thing from the live Worker.

**Why `verify()` is special:** in `briefing-retrieval/src/judge.js`, it's what stops made-up stories reaching your dashboard (Lesson 2). Loosening it deserves a "what will this let through?"

### 2. Shell commands that only look

**What it's asking:** to run a command whose only effect is output: `ls`, `cat`, `grep`, `git status`, `git log`, `git diff`, `node --check`, the tests.

**Check:** that it really is only looking. Words like `rm`, `mv`, `>`, `--force`, `reset`, `deploy`, `put` or `delete` anywhere in the line, including after `&&` or `|`, mean it isn't.

These are the best candidates for "don't ask again", and only in their exact form.

### 3. Shell commands that change your local copy

**Examples:** `npm install`, `npm ci` (download packages), `git checkout`, `git restore`, `rm`, `git clean`.

**Check:** `npm install` can update `package-lock.json`. Fine if that's intended, worth a question if not. Commands that discard changes (`git restore .`, `git checkout -- .`, `git reset --hard`, `git clean -fd`) destroy uncommitted work and can't be undone.

**Stop and ask if** something discards work you haven't seen committed.

### 4. `git commit`

**What it's asking:** to save a snapshot locally. Nothing leaves the machine yet.

**Check:** the list of files in the commit and the message. Your `CLAUDE.md` says Claude Code must ask before committing, so this is your review point. Look for: the reference doc update included, no stray files (scratch output, `node_modules/`, `.dev.vars`, anything in `briefs/`), and a message that says what and why.

### 5. `git push`

**What it's asking:** to copy commits to GitHub. Your repo is public, so this publishes the change to the world, even before it's merged.

**Check:** the branch name. A push to the working branch (like `claude/…`) is normal. A push straight to `main` skips review and, for the page, **goes live**.

**Stop and ask if:** you see `--force` or `-f` (overwrites history on GitHub), the target is `main`, or you haven't seen what's in the commits being pushed.

### 6. GitHub actions: pull requests, comments, merges

**What it's asking:** to act on GitHub through a connector tool (`mcp__github__create_pull_request`, `…merge_pull_request`, `…add_issue_comment`).

**Check:** creating a PR is safe and reviewable; it's how you get a review page. Comments are public. **A merge into `main` puts the page live,** and is your call to make on the PR page, not something to hand off in passing.

### 7. Deploys and rollbacks

**What it's asking:** `npm run deploy`, `wrangler deploy`, `wrangler versions deploy`, `wrangler rollback`: change what's running in Cloudflare right now.

**Check, every time:**
- **Which folder?** `dashboard-worker/` is the `briefing` Worker (every card but two). `briefing-retrieval/` is the overnight briefing.
- **Is the code committed and pushed?** Deploying uncommitted code makes the live Worker differ from anything in git.
- **Was there a recent rollback?** If so, has `wrangler secret list` been checked? (Lesson 5.)
- **Did `wrangler.toml` change?** Then the deploy changes settings too.
- **How will it be checked afterwards?** A good answer names a route and what its `sources` line should say.

**Stop and ask if** any of those answers is unclear. Never approve these with "don't ask again".

### 8. Secrets

**What it's asking:** `wrangler secret put <NAME>`, or a command or file that uses a key.

**Check:** the value should go in at a hidden prompt that you type or paste into, never through the chat. `secret put` also deploys a new version.

**Stop and ask if:** a key value appears in a command (like `curl -H "X-Read-Key: <the real key>"`, which leaks it to process listings; the Oct 21 rotation happened this way), in a file being written, in a URL, or in a request for you to paste it into chat.

### 9. Commands that spend money

**Examples:** `npm run judge-dry-run` (about $0.30 per run, more with `--both`), `POST /judge?direct=1` (a full-price Claude call), anything that would move you off the Workers Free plan.

**Check:** why it's needed now, and whether a cheaper check would answer the same question.

### 10. Network requests

**Examples:** web fetches, `curl` to your Worker's routes.

**Check:** a `GET` to a public route (`/`, `/sports`, `/devotion`, `/sitwith`) reads public data. `PUT` or `POST` changes something. A request to `/calendar`, `/tasks` or `/otf` needs the read key, so check how the key is being passed.

### 11. Other connected services: Notion, Gmail, Calendar, Drive

**What it's asking:** to read or act in a service outside this repo.

**Check:** reading is usually fine if it's relevant to the task. Creating, sending, sharing or deleting is outward-facing and often permanent. The dashboard work almost never needs to send an email or change a Notion page by hand. The Notion story log and deep-dive log are written by the Worker, not by Claude Code, and the deep-dive log is load-bearing.

### 12. Plans and questions

**What it's asking:** to approve a plan, or to pick an option. That's not a permission check. It's a decision.

**Check:** whether the plan matches your goal and whether anything in it falls into the right-hand triage column. Approving a plan doesn't approve every command in it; you'll still get prompts for the risky steps unless the permission mode skips them.

## Good things to type after "No"

- "Before you run that, what does it change, and how would we undo it?"
- "Show me the diff of what's in this commit first."
- "Is this deploying the code that's on the branch, or uncommitted code?"
- "Has `wrangler secret list` been checked since the last rollback?"
- "Can you pass the key without it showing in the command line?"
- "What will you check after the deploy to know it worked?"
- "Is there a way to test this without spending API money?"
- "Why does this need to touch `wrangler.toml`?"

## Self-check

<details>
<summary>1. A prompt offers "Yes, and don't ask again for <code>npx wrangler</code> commands in this folder." Why not click it?</summary>

That one rule covers harmless commands (`secret list`, `tail`) and live-changing ones (`deploy`, `rollback`, `secret put`) alike. You'd lose the chance to check the risky ones. Approve `wrangler` prompts one at a time.
</details>

<details>
<summary>2. Claude Code asks to run <code>git push -u origin claude/fix-sports</code>. What does approving do, and is it live?</summary>

It publishes the branch's commits to GitHub, where anyone can see them (public repo). It isn't live: the page goes live on merge to `main`, and Workers only on `npm run deploy`.
</details>

<details>
<summary>3. A diff for "tidy up the config" removes the <code>[[kv_namespaces]]</code> block from <code>dashboard-worker/wrangler.toml</code>. What happens if it's deployed?</summary>

The deploy removes the `BRIEFING` binding from the live Worker, so it can no longer read or write today's briefing, the sit-with archive or the Orangetheory data. That's part of what broke on Oct 20. Stop and ask why the block is being removed.
</details>

<details>
<summary>4. Claude Code wants to run <code>npm run deploy</code> from <code>dashboard-worker/</code>. You rolled the Worker back yesterday. What do you ask first?</summary>

"Has `wrangler secret list` been checked?" After a rollback, the newest version (which a deploy copies secrets from) may not be the live one, and may have no secrets. A deploy could take every keyed card down.
</details>

<details>
<summary>5. A prompt asks to run <code>npm run judge-dry-run -- --both</code>. What three things would you want to know?</summary>

Why it's needed (what question it answers), what it costs (about $0.30 per edition, and `--both` runs a second model too), and confirmation that it publishes nothing (it doesn't: dry runs write locally only).
</details>

Next: [Lesson 7 · When something breaks](lesson-7-when-something-breaks.md)
