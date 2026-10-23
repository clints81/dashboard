# The morning dashboard: a course

This course teaches how the morning dashboard works, using its own code as the examples. It's written for someone who approves Claude Code's work without writing code, and it has two goals:

1. Read and follow what Claude Code shows while it works: tool calls, diffs, git steps, test output, and especially approval prompts.
2. When something breaks, form a hypothesis and ask Claude Code a sharper question.

It doesn't teach programming. Code excerpts are there so you can recognize things when they scroll past, not so you can write them.

## How to use it

**Coming back to the project after a break?** Read Layer 1 (about 5 minutes).

**Learning it properly?** Take the Layer 2 lessons in order, one per sitting, about 10 minutes each. Each lesson ends with self-check questions about your own system. The answers are hidden: click the question to open the answer.

## Layer 1: the refresher

| | |
|---|---|
| [00 · The map](00-map.md) | How the pieces connect, and what happens on a typical morning |
| [01 · Glossary](01-glossary.md) | The terms Claude Code uses, each tied to where it shows up in your files |

## Layer 2: lessons

| # | Lesson | You'll be able to |
|---|---|---|
| 1 | [What runs where, and in what order](lesson-1-what-runs-where.md) | Name the four running pieces and the order they run in overnight and at 6am |
| 2 | [Fetched vs. generated](lesson-2-fetched-vs-generated.md) | Tell which words on the dashboard came from the web and which Claude wrote |
| 3 | [Keys and secrets](lesson-3-keys-and-secrets.md) | Say where each key lives, what it unlocks, and why it never goes in the repo |
| 4 | [Reading Claude Code at work: tool calls, diffs, test output](lesson-4-tool-calls-diffs-tests.md) | Follow along as Claude Code reads, searches, edits and tests |
| 5 | [Reading Claude Code at work: branches to deploys](lesson-5-branches-to-deploys.md) | Know whether a change is saved, shared, merged, or actually live |
| 6 | [Approval prompts](lesson-6-approval-prompts.md) | Know what each prompt is asking, what to check, and when to stop and ask |
| 7 | [When something breaks](lesson-7-when-something-breaks.md) | Go from a symptom to a likely place to a good question |

## Ground rules for this course

- **No secret values appear anywhere in it.** Where a key would go, you'll see a placeholder like `<READ_KEY>`. Lesson 3 explains where the real values live.
- **Concepts get their general names.** "The `briefing` Worker" is your instance of a *serverless function*; "KV" is your instance of a *key-value store*. The general names carry over to your other projects.
- **It isn't published on the dashboard site.** `_config.yml` at the repo root tells GitHub Pages to leave `course/` out. It's still public on github.com, like everything in this repo.
- **It's kept current.** `CLAUDE.md` tells Claude Code to update the matching lessons whenever a change affects architecture, data flow, keys or deployment. If a lesson disagrees with `DASHBOARD-REFERENCE.md`, trust the reference doc and ask Claude Code to fix the lesson.

Each lesson lists the files it depends on at the top. If one of those files changes a lot, that lesson is the one to check.
