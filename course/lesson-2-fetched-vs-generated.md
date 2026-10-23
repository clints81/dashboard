# Lesson 2 · Fetched vs. generated

*About 10 minutes.*

**Depends on:** `app.js` (`loadBriefing`), `config.js` (`sitWith`), `briefing-retrieval/src/briefing-prompt.md`, `briefing-retrieval/src/judge.js` (`verify`, `toDashboard`, `failureEdition`), `briefing-retrieval/wrangler.toml` (`MODEL`, `PUBLISH`), `dashboard-worker/src/index.js` (sports matching, devotion parsing)

## The concept

Every word on your dashboard came from one of four places, and they fail in different ways:

1. **Fetched**: copied from a source as-is, or cut down by fixed rules. Weather, calendar events, Notion tasks, the devotion verse, sports headlines, Orangetheory numbers, On this day. If it's wrong, the source was wrong or the rules misread it.
2. **Generated**: written by a language model (Claude, through the Claude API). The briefing's synthesis, each story's title, summary and category, and the sit-with pick's type and description. If it's wrong, the model got it wrong, so it has to be checked.
3. **Written by your own code**: fixed messages the Workers or the page produce, like "Partial edition: …" or "No briefing yet today."
4. **Static**: typed into `config.js` by hand and shown when nothing better is available.

The general distinction is *deterministic* versus *model* output. Deterministic code does the same thing with the same input every time, so once it's right it stays right until the input changes shape. A model can give a different answer each run and can state something confidently that isn't true. A well-built system lets the model *choose and phrase* but has deterministic code *check and supply the facts*. Yours does exactly that, and it's worth knowing where the line sits.

## Where it lives in your files

### Only one card is generated

Of the nine loaders in `app.js`, only `loadBriefing()` shows model-written text. Everything else is fetched. Even the sports card, which looks "curated", is picked by fixed rules: a story counts as a Cubs story if the Cubs are in its web address, not because anything read and judged it (see "Matching strategy" in `DASHBOARD-REFERENCE.md`).

### The model is told it may only use what it's given

From `briefing-retrieval/src/briefing-prompt.md`, the instructions sent to Claude every night:

> You are not searching the web. The request gives you a candidate pool gathered overnight from structured feeds, plus the story log of what Clint has already been shown. Everything you include must rest on items in the request, cited by ID. Do not add facts, dates or events the items don't support, including things you believe you know: your own knowledge of current events is out of date.

Each pool item has an ID: `N12` for a news item, `S4` for a long read, `W3` for something from this week's briefings. Claude answers with IDs. **It never writes a web address.**

### The Worker checks everything and supplies the facts

`verify()` in `briefing-retrieval/src/judge.js` resolves each ID back to the real pool item and drops anything that doesn't check out:

```js
// Everything the model returned is checked against the request here. What
// fails is dropped and recorded in `problems`; nothing is filled in.
...
    if (bad.length) problems.push(`"${e.title}": ${bad.join(', ')} not in the request or not allowed here, ignored`);
    if (dup.length) problems.push(`"${e.title}": ${dup.join(', ')} already used elsewhere, ignored`);
    if (!ok.length) problems.push(`dropped "${e.title}": nothing in the request behind it`);
```

For the sit-with pick you can see the line exactly. Claude supplies `type` and `desc`; the pool supplies the headline, source, read time and link:

```js
    else sit_with = {
      type: oneLine(sw.type), headline: oneLine(it.title), desc: oneLine(sw.desc), source: it.publisher,
      read_time: it.read_minutes != null ? `~${it.read_minutes} min` : 'length not measured', url: it.url,
```

`sw` is what Claude sent; `it` is the real pool item. So:

| On the card | Who wrote it |
|---|---|
| Synthesis (the lede sentence) | Claude |
| Story title, summary, category | Claude |
| Story link | Worker, from the pool, preferring the NYT copy |
| `· floor` label | Worker (marks a story included to meet the one-Tech, one-Science, one-Religion floor) |
| "Partial edition: N stories cleared verification…" | Worker, when too few stories survived the check |
| "No briefing this morning. … Nothing here is from yesterday." | Worker (`failureEdition()`), when the night failed |
| Sit-with type and description | Claude |
| Sit-with headline, source, read time, link | Worker, from the pool |
| "No briefing yet today. Showing Thursday's." | The page (`app.js`), when the stored briefing's date isn't today |
| Sit-with text when the briefing can't load at all | `config.js` (`CONFIG.sitWith`) |

Which model writes it is a setting, not code: `MODEL = "claude-opus-5-5"` in `briefing-retrieval/wrangler.toml`.

### Fetched doesn't mean untouched

The fetched cards still pass through your code, which can misread them. The devotion route finds the verse by the shape of the WELS feed; if WELS changes its template, `sources.wels` says `parse-miss`. The calendar route turns raw calendar files into times; that's where the time-zone bugs lived. "Fetched" tells you the facts came from outside. It doesn't tell you the code read them right.

## What it looks like when Claude Code is working on it

- **Edits to `briefing-prompt.md`** change how Claude writes the briefing. It's plain English, so you can read the diff yourself and judge it. It only takes effect after `npm run deploy` from `briefing-retrieval/` (the prompt is bundled into the Worker), and you'll see the result the next morning.
- **`npm run judge-dry-run`** writes one edition from the live pool on Claude Code's machine and publishes nothing. It calls the Claude API, so it costs real money (about $0.30 per the README; `--both` runs a second model too). Expect it to ask before running.
- **Checking a briefing**: Claude Code may open `briefing-retrieval.clintsievers.workers.dev/brief`, which shows the full edition with every source behind each story and a "Dropped / fixed" row listing what `verify()` threw out and why. That page is the first place to look when a story seems wrong.
- **Edits to `verify()` or `toDashboard()`** change the checking, which is the safety net. Lesson 6 explains why these deserve a careful look.

## Self-check

<details>
<summary>1. A briefing story links to the wrong article. Did Claude write the bad link?</summary>

No. Claude never writes links; it cites pool IDs, and the Worker picks the link from the cited items (preferring NYT). Either Claude cited the wrong item for that story, or the pool item itself carried a bad link from its feed. The `/brief` page shows which IDs and sources sat behind the story.
</details>

<details>
<summary>2. The synthesis starts "Partial edition: 7 stories cleared verification tonight…". Who wrote that sentence, and what does it mean happened?</summary>

The Worker wrote it, not Claude. It means Claude proposed stories but fewer than the weekday minimum of 10 survived `verify()`. The "Dropped / fixed" row on `/brief` says what was dropped and why.
</details>

<details>
<summary>3. Which of these could be a model mistake: the calendar showing a meeting at 4am, the sports card missing a Lions story, or a story summary overstating a vote count?</summary>

Only the summary. Calendar and sports are fetched and filtered by fixed code, so their mistakes are code or source mistakes (the 4am meeting is a time-zone bug, like the October one). The summary is Claude's wording, which `verify()` doesn't fact-check line by line: it confirms the story rests on real pool items, not that every phrase is accurate.
</details>

<details>
<summary>4. You want the briefing summaries to sound less formal. Which file changes, and when would you see the effect?</summary>

`briefing-retrieval/src/briefing-prompt.md`. Then `npm run deploy` from `briefing-retrieval/`, and the next overnight run uses it. You'd see it the next morning (or sooner if Claude Code runs a `judge-dry-run`, which costs money and publishes nothing).
</details>

<details>
<summary>5. When does the dashboard show the sit-with text from <code>config.js</code>?</summary>

Only when the briefing can't be loaded at all (the request to the `briefing` Worker fails). The `catch` branch of `loadBriefing()` in `app.js` falls back to `CONFIG.sitWith`. On a normal morning the overnight pick wins.
</details>

Next: [Lesson 3 · Keys and secrets](lesson-3-keys-and-secrets.md)
