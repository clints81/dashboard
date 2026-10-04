// Every source the pool pulls from. One entry = one unit of work in a run.
//
//   id        stable key; used in KV status and stats, so don't rename casually
//   pool      'news' (last NEWS_WINDOW_HOURS) or 'sitwith' (rolling 7 days)
//   kind      which fetcher handles it (see fetchers.js)
//   priority  lower wins when two sources carry the same URL. NYT first,
//             because NYT is the preferred link target.
//   rate      'nyt' units are spread one per tick (NYT allows 5 calls/min)
//
// Verified 2026-10-04 from both a Mac and a Cloudflare Worker. Dropped after
// testing: The Ringer (no RSS, every feed URL 404s), Politico picks (403),
// Atlantic magazine channel (404), New Yorker longreads tag (404).

const NYT_RSS = 'https://rss.nytimes.com/services/xml/rss/nyt/';

export const SOURCES = [
  // ── News pool ──────────────────────────────────────────────────────────
  { id: 'nyt-top-home',     pool: 'news', kind: 'nyt-top', section: 'home',     publisher: 'The New York Times', priority: 0, rate: 'nyt' },
  { id: 'nyt-top-world',    pool: 'news', kind: 'nyt-top', section: 'world',    publisher: 'The New York Times', priority: 0, rate: 'nyt' },
  { id: 'nyt-top-us',       pool: 'news', kind: 'nyt-top', section: 'us',       publisher: 'The New York Times', priority: 0, rate: 'nyt' },
  { id: 'nyt-top-politics', pool: 'news', kind: 'nyt-top', section: 'politics', publisher: 'The New York Times', priority: 0, rate: 'nyt' },
  { id: 'nyt-newswire',     pool: 'news', kind: 'nyt-newswire',                 publisher: 'The New York Times', priority: 0, rate: 'nyt' },
  // Keyless backstop: if the API key is missing or rate-limited, NYT links still land.
  { id: 'nyt-rss-home',     pool: 'news', kind: 'rss', url: NYT_RSS + 'HomePage.xml', publisher: 'The New York Times', priority: 1 },
  { id: 'guardian-news',    pool: 'news', kind: 'guardian', query: { section: 'world|us-news|politics|business|technology|science' }, publisher: 'The Guardian', priority: 2 },
  { id: 'npr',              pool: 'news', kind: 'rss', url: 'https://feeds.npr.org/1001/rss.xml', publisher: 'NPR', priority: 3 },
  { id: 'bbc-top',          pool: 'news', kind: 'rss', url: 'https://feeds.bbci.co.uk/news/rss.xml', publisher: 'BBC News', priority: 3 },
  { id: 'bbc-world',        pool: 'news', kind: 'rss', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', publisher: 'BBC News', priority: 3 },
  { id: 'bbc-us-canada',    pool: 'news', kind: 'rss', url: 'https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml', publisher: 'BBC News', priority: 3 },
  { id: 'politico-politics', pool: 'news', kind: 'rss', url: 'https://rss.politico.com/politics-news.xml', publisher: 'Politico', priority: 3 },
  { id: 'politico-congress', pool: 'news', kind: 'rss', url: 'https://rss.politico.com/congress.xml', publisher: 'Politico', priority: 3 },
  { id: 'ars-technica',     pool: 'news', kind: 'rss', url: 'https://feeds.arstechnica.com/arstechnica/index', publisher: 'Ars Technica', priority: 3 },

  // ── Something-to-sit-with pool ─────────────────────────────────────────
  { id: 'nyt-magazine',      pool: 'sitwith', kind: 'rss', url: NYT_RSS + 'Magazine.xml', publisher: 'The New York Times', priority: 0 },
  { id: 'nyt-sunday-review', pool: 'sitwith', kind: 'rss', url: NYT_RSS + 'sunday-review.xml', publisher: 'The New York Times', priority: 0 },
  { id: 'athletic',          pool: 'sitwith', kind: 'rss', url: 'https://www.nytimes.com/athletic/rss/news/', publisher: 'The Athletic', priority: 1 },
  { id: 'atlantic',          pool: 'sitwith', kind: 'rss', url: 'https://www.theatlantic.com/feed/all/', publisher: 'The Atlantic', priority: 2 },
  { id: 'aldaily',           pool: 'sitwith', kind: 'aldaily', url: 'https://www.aldaily.com/feed/', publisher: 'Arts & Letters Daily', priority: 2, heavy: true },
  { id: 'wired-longreads',   pool: 'sitwith', kind: 'rss', url: 'https://www.wired.com/feed/tag/longreads/latest/rss', publisher: 'Wired', priority: 2 },
  { id: 'wired-features',    pool: 'sitwith', kind: 'rss', url: 'https://www.wired.com/feed/category/backchannel/latest/rss', publisher: 'Wired', priority: 2 },
  { id: 'dispatch',          pool: 'sitwith', kind: 'rss', url: 'https://thedispatch.com/feed/', publisher: 'The Dispatch', priority: 2 },
  { id: 'new-yorker',        pool: 'sitwith', kind: 'rss', url: 'https://www.newyorker.com/feed/magazine/rss', publisher: 'The New Yorker', priority: 2 },
  { id: 'foreign-affairs',   pool: 'sitwith', kind: 'rss', url: 'https://www.foreignaffairs.com/rss.xml', publisher: 'Foreign Affairs', priority: 2 },
  { id: 'guardian-longread', pool: 'sitwith', kind: 'guardian', query: { tag: 'news/series/the-long-read' }, rssFallback: 'https://www.theguardian.com/news/series/the-long-read/rss', publisher: 'The Guardian', priority: 2 },
  { id: 'comment',           pool: 'sitwith', kind: 'rss', url: 'https://comment.org/feed/', publisher: 'Comment', priority: 2 },
  { id: 'christianity-today', pool: 'sitwith', kind: 'rss', url: 'https://www.christianitytoday.com/feed/', publisher: 'Christianity Today', priority: 2 },
];

export const NEWS_WINDOW_HOURS = 36;
export const SITWITH_WINDOW_DAYS = 7;
// The Athletic's feed is ~100 mostly-short items a day; without a cap it
// would swamp the rolling pool.
export const SITWITH_PER_SOURCE_CAP = 40;
