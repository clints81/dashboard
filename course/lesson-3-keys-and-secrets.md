# Lesson 3 · Keys and secrets

*About 10 minutes.*

**Depends on:** `app.js` (read-key section, `fetchRetry`), `dashboard-worker/src/index.js` (`READ_GATE`, the root `PUT`, `OTF`), `dashboard-worker/wrangler.toml`, `briefing-retrieval/wrangler.toml`, `briefing-retrieval/.dev.vars.example`, `briefing-retrieval/src/judge.js` (`putDashboard`), both Worker `.gitignore` files, `DASHBOARD-REFERENCE.md` (Read key, The write key paragraph, The Git build outage, otf-sync)

*No secret values appear in this lesson. `<READ_KEY>` and similar are placeholders.*

## The concept

A **secret** is any value that, on its own, lets someone do something: read your data, change your data, or spend your money. Keys, tokens, passwords and secret links are all secrets. Three rules carry over to every project:

1. **A secret lives in a secret store, never in code.** Code gets published, copied and kept in history forever. Secret stores (Cloudflare's Worker secrets, GitHub Actions secrets, 1Password) are built to hold values that programs can use but people can't casually read.
2. **Each secret should allow as little as possible.** Your read key can read but not write. Your write key can write but not read. A leak of one doesn't hand over everything.
3. **A secret that might have leaked gets rotated, not deleted.** Removing it from a file doesn't remove it from git history, a log, a screenshot or a chat transcript. Only a new value makes the old one useless.

Your repo is **public**, and so is `app.js` (anyone can view a web page's source). That's why rule 1 is absolute here.

## Where it lives in your files

### The read key: lets a device see your private cards

Three routes return personal data: `/calendar` (your schedule), `/tasks` (the church's payables) and `/otf` (your workouts). They need the read key. The check is `READ_GATE` in `dashboard-worker/src/index.js`:

```js
  function check(request, env, cors) {
    const deny = (status, auth) => new Response(
      JSON.stringify({ error: 'locked', sources: { auth } }),
      { status, headers: { ...cors, 'cache-control': 'no-store' } });

    if (!env.READ_KEY) return deny(500, 'READ_KEY unset');   // fail closed
    const sent = request.headers.get('X-Read-Key');
    if (!sent) return deny(401, 'missing');
    if (sent !== env.READ_KEY) return deny(401, 'rejected');
    return null;
  }
```

Read it line by line: if the Worker has no key configured, refuse everyone (*fail closed*: when unsure, lock rather than open). If the request has no key, 401 "missing". If it has the wrong one, 401 "rejected". Otherwise, let it through. This check runs *before* the cache, so a request without the key can't be handed a saved copy someone else fetched.

The page side, in `app.js`:

```js
// /calendar, /tasks and /otf need X-Read-Key. The key is entered once per device
// and kept in this browser's storage, never in the repo or this file.
...
const READ_KEY_STORE = 'dashReadKey';
```

Where the read key lives:
- Cloudflare: the `READ_KEY` secret on the `briefing` Worker
- 1Password: item "Dashboard read key"
- Each device's browser storage (`localStorage["dashReadKey"]`), typed in once on the card

### The write key: lets a program change what's stored

The root `PUT` (today's briefing) and `PUT /otf` (Orangetheory data) need the write key:

```js
    if (request.method === "PUT") {
      if (request.headers.get("X-Write-Key") !== env.WRITE_KEY) {
        return new Response("Forbidden", { status: 403, headers: cors });
      }
```

Where the write key lives, all the same value:
- Cloudflare: `WRITE_KEY` on the `briefing` Worker (the lock)
- Cloudflare: `DASHBOARD_WRITE_KEY` on `briefing-retrieval` (so it can deliver the briefing)
- GitHub Actions: `DASHBOARD_WRITE_KEY` in the private `otf-sync` repo (so it can deliver workouts)
- 1Password

Rotating it means updating all three programs' copies plus 1Password. Miss one and that program's deliveries start failing with 403.

### Everything else, by name only

| Secret | Held by | What someone holding it could do |
|---|---|---|
| `CAL_ICS_1`, `CAL_ICS_2` | `briefing` Worker | Read your whole Google and family calendars. A secret calendar link *is* the key. |
| `NOTION_TOKEN` | `briefing` Worker | Read the JELC treasurer database (whatever that Notion connection was granted) |
| `NOTION_TOKEN` | `briefing-retrieval` | Read and append to the story log and deep-dive log pages |
| `ANTHROPIC_API_KEY` | `briefing-retrieval` | Run Claude on your account, at your expense |
| `NYT_API_KEY`, `GUARDIAN_API_KEY` | `briefing-retrieval` | Use up your API quotas |
| `RUN_KEY` | `briefing-retrieval` | Trigger a run or a briefing by hand (`POST /run`, `POST /judge`), which can spend API money |
| `OTF_EMAIL`, `OTF_PASSWORD`, a separate `NOTION_TOKEN` | `otf-sync` Actions secrets | Log in to Orangetheory as you; read the OTF Monthly Posts database (that token can open nothing else) |

The repo only ever names them. The bottom of `dashboard-worker/wrangler.toml`:

```toml
# Secrets (set with `npx wrangler secret put <NAME>`, never committed):
#   CAL_ICS_1, CAL_ICS_2, NOTION_TOKEN, READ_KEY, WRITE_KEY
```

For running a Worker on a laptop, `briefing-retrieval/.dev.vars.example` is a template with empty values. The real copy, `.dev.vars`, is listed in that folder's `.gitignore`, so git can't commit it.

### How secrets have actually leaked or nearly leaked here

These are in `DASHBOARD-REFERENCE.md`, and they're the patterns to watch for:

- **A key in a command line (Oct 21).** A helper script passed the read key to `curl` as an argument. A process listing taken to check progress showed it in a Claude Code transcript. It never reached a file, but it was treated as exposed and rotated. The rule since: scripts feed keys to `curl` through standard input (`curl -K -`), never as an argument.
- **A key in task text (Oct 8).** The write key used to be written into the old Cowork briefing task's text. It was rotated on Oct 8, when it was taken out of that task.
- **Secrets lost in a deploy (Oct 20–21).** Not a leak, the opposite: an accidental deploy produced a version with *no* secrets, and the dashboard went dark. Lesson 5 tells that story.

## What it looks like when Claude Code is working on it

- **`npx wrangler secret list`** shows secret *names* only. Safe to approve. Claude Code runs it before a deploy to confirm all five are there.
- **`npx wrangler secret put READ_KEY`** asks for the value at a hidden prompt. That's where the value should go: typed or pasted by you into a terminal, never into the chat. It also deploys a new version of the Worker with the new value.
- **`curl -H "X-Read-Key: …"`** in a command Claude Code wants to run is a warning sign. The value would show in the command line. Ask it to use the stdin pattern instead.
- **A diff that adds a long random-looking string** to any file is a hard stop. Ask what it is before approving.
- **Claude Code asking you to paste a key into chat.** Don't. Ask how to set it without the chat seeing it.

## Self-check

<details>
<summary>1. Someone copies your write key. What can they do, and what can't they?</summary>

They can overwrite today's briefing and your Orangetheory data (the two `PUT` routes). They can't read your calendar, tasks or workouts: those need the read key, and the write key doesn't open them. The fix is to rotate the write key in all three places (`briefing`'s `WRITE_KEY`, `briefing-retrieval`'s `DASHBOARD_WRITE_KEY`, otf-sync's Actions secret) and 1Password.
</details>

<details>
<summary>2. Why can't the read key just be written into <code>app.js</code>, since the page needs it anyway?</summary>

`app.js` is public twice over: it's in a public repo, and anyone visiting the site can view its source. A key in it would be a key for everyone. Keeping it in each device's browser storage means only devices you typed it into have it.
</details>

<details>
<summary>3. You get a new iPad. The calendar card says "Locked on this device · Enter key". Is anything broken?</summary>

No. The read key lives in each device's browser storage, and the new iPad doesn't have it yet. Tap Enter key and paste it from 1Password ("Dashboard read key").
</details>

<details>
<summary>4. Claude Code proposes running <code>curl -H "X-Read-Key: &lt;the actual key&gt;" https://briefing.clintsievers.workers.dev/calendar</code>. What's the issue, and what do you ask?</summary>

The key would sit in the command line, where any process listing (and the session transcript) can show it. That's how the Oct 21 rotation happened. Ask Claude Code to pass the key through stdin (`curl -K -` fed a header line), as the reference doc requires.
</details>

<details>
<summary>5. A key was committed to the repo and removed in the very next commit, ten minutes later. Is it safe now?</summary>

No. It's still in git history, and the repo is public, so anyone can see the earlier commit. Rotate it.
</details>

Next: [Lesson 4 · Tool calls, diffs, test output](lesson-4-tool-calls-diffs-tests.md)
