# 00 · The map

*Layer 1 refresher. About 3 minutes.*

**Depends on:** `index.html`, `app.js`, `config.js`, `dashboard-worker/wrangler.toml`, `dashboard-worker/src/index.js`, `briefing-retrieval/wrangler.toml`, `briefing-retrieval/src/judge.js`, `DASHBOARD-REFERENCE.md`

## The pieces

Your dashboard is four programs running in four places, plus the services they borrow from.

```
                         ┌──────────────────────────────────────────┐
  overnight, on a timer  │  briefing-retrieval  (Cloudflare Worker)  │
                         │  briefing-retrieval/                      │
                         │  news feeds → Claude API → checks it      │
                         └──────────────┬───────────────────────────┘
                                        │ PUT the briefing (write key)
                                        ▼
  3x a day, on a timer   ┌──────────────────────────────────────────┐
  ┌───────────────────┐  │  briefing  (Cloudflare Worker)            │
  │ otf-sync          │  │  dashboard-worker/                        │
  │ (GitHub Action,   │──▶  stores: briefing, sit-with archive, OTF  │
  │  private repo,    │  │  fetches for the page: sports, calendar,  │
  │  NOT in this repo)│  │  Notion tasks, devotion                   │
  └───────────────────┘  └──────────────▲───────────────────────────┘
       PUT /otf (write key)             │ GET (read key for 3 routes)
                                        │
                         ┌──────────────┴───────────────────────────┐
  when you open it       │  the page  (your iPad's browser)          │
                         │  index.html + config.js + app.js          │
                         │  served by GitHub Pages                   │──▶ Open-Meteo (weather)
                         └──────────────────────────────────────────┘──▶ Wikipedia (On this day)
```

| Piece | Lives in this repo? | Runs on | Goes live when |
|---|---|---|---|
| The page | Yes: `index.html`, `app.js`, `config.js` | Your iPad's browser, served by GitHub Pages | A change reaches `main` (automatic) |
| `briefing` Worker | Yes: `dashboard-worker/` | Cloudflare | Someone runs `npm run deploy` in that folder |
| `briefing-retrieval` Worker | Yes: `briefing-retrieval/` | Cloudflare, on a timer | Someone runs `npm run deploy` in that folder |
| otf-sync | **No.** Private repo `clints81/otf-sync` | GitHub Actions, on a timer | Its own repo's schedule |

## A typical morning (Central time, daylight saving; an hour earlier in winter)

1. **1:00am.** `briefing-retrieval` wakes every 5 minutes and pulls news and long reads from feeds and APIs into a *candidate pool*. It saves its progress between wake-ups because the free plan only allows a sliver of computing time per run.
2. **Usually by about 2:30am.** The pool is ready. On the next wake-up the Worker sends the pool to the Claude API as a *batch* (half price, back within minutes). If the batch isn't back by 4:30am, it asks again directly at full price.
3. **When Claude answers.** The Worker checks every story against the pool, drops anything it can't back up, picks the links itself, and PUTs the finished briefing to the `briefing` Worker using the write key. It also logs the day's stories to its own store and to Notion.
4. **3:40am.** otf-sync logs in to Orangetheory, gathers your classes and the month's plan, and PUTs them to the `briefing` Worker's `/otf` route with the same write key.
5. **About 6am, you open the iPad.** GitHub Pages hands over `index.html`, which loads `config.js` and then `app.js`. `app.js` fires off nine requests at once. Weather and On this day go straight to Open-Meteo and Wikipedia. The other seven go to the `briefing` Worker, which answers from its storage (briefing, sit-with archive, Orangetheory) or fetches on the page's behalf (sports, calendar, Notion tasks, devotion).
6. **All day.** Each time the app comes back to the foreground (at most once a minute) or the iPad reconnects, the page asks for everything again.

## Two things to keep in your head

**Merging changes the page; it doesn't change the Workers.** GitHub Pages republishes whenever `main` changes. The Workers change only when someone deploys them. So "it's merged" and "it's live" mean the same thing for `app.js`, and different things for `dashboard-worker/src/index.js`.

**Every card says when it's broken.** The cards are built to fail loudly: "Calendar unavailable", "Key rejected", "No briefing yet today". Each Worker route also returns a `sources` block saying how each upstream fetch went. A blank card or a "quiet day" that's actually a failure is treated as a bug.

Next: [01 · Glossary](01-glossary.md)
