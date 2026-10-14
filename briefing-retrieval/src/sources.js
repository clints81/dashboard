// Every source the pool pulls from. One entry = one unit of work in a run.
//
//   id        stable key; used in KV status and stats, so don't rename casually
//   pool      'news' (last NEWS_WINDOW_HOURS) or 'sitwith' (rolling 7 days)
//   kind      which fetcher handles it (see fetchers.js)
//   priority  lower wins when two sources carry the same URL. NYT first,
//             because NYT is the preferred link target.
//   rate      'nyt' units are spread one per tick (NYT allows 5 calls/min)
//
//   length    how sit-with read length is measured when the feed lacks it
//             (see lengths.js)
//
// Verified 2026-10-04 from both a Mac and a Cloudflare Worker. Dropped after
// testing: The Ringer (no RSS, every feed URL 404s), Politico picks (403),
// Atlantic magazine channel (404), New Yorker longreads tag (404), NYT Times
// Newswire API (no longer offered on developer.nytimes.com).

const NYT_RSS = 'https://rss.nytimes.com/services/xml/rss/nyt/';

export const SOURCES = [
  // ── News pool ──────────────────────────────────────────────────────────
  { id: 'nyt-top-home',     pool: 'news', kind: 'nyt-top', section: 'home',     publisher: 'The New York Times', priority: 0, rate: 'nyt' },
  { id: 'nyt-top-world',    pool: 'news', kind: 'nyt-top', section: 'world',    publisher: 'The New York Times', priority: 0, rate: 'nyt' },
  { id: 'nyt-top-us',       pool: 'news', kind: 'nyt-top', section: 'us',       publisher: 'The New York Times', priority: 0, rate: 'nyt' },
  { id: 'nyt-top-politics', pool: 'news', kind: 'nyt-top', section: 'politics', publisher: 'The New York Times', priority: 0, rate: 'nyt' },
  { id: 'nyt-top-business', pool: 'news', kind: 'nyt-top', section: 'business', publisher: 'The New York Times', priority: 0, rate: 'nyt' },
  { id: 'nyt-top-technology', pool: 'news', kind: 'nyt-top', section: 'technology', publisher: 'The New York Times', priority: 0, rate: 'nyt' },
  { id: 'nyt-top-science',  pool: 'news', kind: 'nyt-top', section: 'science',  publisher: 'The New York Times', priority: 0, rate: 'nyt' },
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
  // Added 2026-10-06. WSJ has no politics feed (404); Markets left out (mostly
  // "Stock Market Today" updates). ~120 items per 36 hours across these five.
  ...Object.entries({ world: 'RSSWorldNews', us: 'RSSUSnews', business: 'WSJcomUSBusiness', tech: 'RSSWSJD', economy: 'socialeconomyfeed' }).map(([id, f]) => (
    { id: `wsj-${id}`, pool: 'news', kind: 'rss', url: `https://feeds.content.dowjones.io/public/rss/${f}`, publisher: 'The Wall Street Journal', priority: 3 })),

  // ── Something-to-sit-with pool ─────────────────────────────────────────
  { id: 'nyt-magazine',      pool: 'sitwith', kind: 'rss', url: NYT_RSS + 'Magazine.xml', publisher: 'The New York Times', length: 'nyt-search', priority: 0 },
  { id: 'nyt-sunday-review', pool: 'sitwith', kind: 'rss', url: NYT_RSS + 'sunday-review.xml', publisher: 'The New York Times', length: 'nyt-search', priority: 0 },
  // The news feed is ~100 items a day, mostly game coverage. Slugs name what a
  // story is, so exclusions match the URL: live blogs, interactives, how-to-
  // watch, fantasy, picks/odds, injury and inactives notes, score recaps.
  // No read length: pages 403 and Article Search doesn't index The Athletic.
  { id: 'athletic', pool: 'sitwith', kind: 'rss', url: 'https://www.nytimes.com/athletic/rss/news/', publisher: 'The Athletic', length: 'none', priority: 1, cap: 8,
    exclude: { url: /\/(live-blogs|interactive)\/|stream-how-to-watch|fantasy|-picks-|-odds-|predictions|injury|inactives|score-result|result-score|-score-|-takeaways/i, title: /^how to watch|live (scores|updates)|fantasy/i } },
  { id: 'atlantic',          pool: 'sitwith', kind: 'rss', url: 'https://www.theatlantic.com/feed/all/', publisher: 'The Atlantic', length: 'none', priority: 2 },
  { id: 'aldaily',           pool: 'sitwith', kind: 'aldaily', url: 'https://www.aldaily.com/feed/', publisher: 'Arts & Letters Daily', length: 'page', priority: 2, heavy: true },
  { id: 'wired-longreads',   pool: 'sitwith', kind: 'rss', url: 'https://www.wired.com/feed/tag/longreads/latest/rss', publisher: 'Wired', length: 'page-text', priority: 2 },
  { id: 'wired-features',    pool: 'sitwith', kind: 'rss', url: 'https://www.wired.com/feed/category/backchannel/latest/rss', publisher: 'Wired', length: 'page-text', priority: 2 },
  { id: 'dispatch',          pool: 'sitwith', kind: 'rss', url: 'https://thedispatch.com/feed/', publisher: 'The Dispatch', length: 'page', priority: 2 },
  { id: 'new-yorker',        pool: 'sitwith', kind: 'rss', url: 'https://www.newyorker.com/feed/magazine/rss', publisher: 'The New Yorker', length: 'page', priority: 2 },
  { id: 'foreign-affairs',   pool: 'sitwith', kind: 'rss', url: 'https://www.foreignaffairs.com/rss.xml', publisher: 'Foreign Affairs', length: 'page-text', priority: 2 },
  // RSS, not the API: on 2026-10-04 the API's tag query returned 1 Long Read
  // for the week while the RSS feed had all ~5, each with a real pubDate.
  { id: 'guardian-longread', pool: 'sitwith', kind: 'rss', url: 'https://www.theguardian.com/news/series/the-long-read/rss', publisher: 'The Guardian', length: 'page', priority: 2 },
  { id: 'comment',           pool: 'sitwith', kind: 'rss', url: 'https://comment.org/feed/', publisher: 'Comment', length: 'page-text', priority: 2 },
  { id: 'christianity-today', pool: 'sitwith', kind: 'rss', url: 'https://www.christianitytoday.com/feed/', publisher: 'Christianity Today', length: 'page', priority: 2 },
  // Added 2026-10-06 for the Sunday long read (it replaced the Cowork deep-dive
  // task). Free outlets publish no wordCount metadata, so their text is counted.
  // WSJ and the Post have no long-form feed; these are their feature sections,
  // capped because they're mostly short. Their pages block length checks (WSJ
  // 401, Post times out), so their read length stays unknown. Clint reads both
  // through Apple News. Left out on purpose: 1843, Harper's, MIT Technology
  // Review (no access).
  { id: 'new-york',          pool: 'sitwith', kind: 'rss', url: 'https://feeds.feedburner.com/nymag/intelligencer', publisher: 'New York', length: 'page-text', priority: 2, cap: 12 },
  { id: 'noema',             pool: 'sitwith', kind: 'rss', url: 'https://www.noemamag.com/feed/', publisher: 'Noema', length: 'page-text', priority: 2 },
  { id: 'aeon',              pool: 'sitwith', kind: 'rss', url: 'https://aeon.co/feed.rss', publisher: 'Aeon', length: 'page-text', priority: 2 },
  { id: 'nautilus',          pool: 'sitwith', kind: 'rss', url: 'https://nautil.us/feed/', publisher: 'Nautilus', length: 'page-text', priority: 2 },
  { id: 'wsj-arts',          pool: 'sitwith', kind: 'rss', url: 'https://feeds.content.dowjones.io/public/rss/RSSArtsCulture', publisher: 'The Wall Street Journal', length: 'none', priority: 2, cap: 12 },
  { id: 'wsj-lifestyle',     pool: 'sitwith', kind: 'rss', url: 'https://feeds.content.dowjones.io/public/rss/RSSLifestyle', publisher: 'The Wall Street Journal', length: 'none', priority: 2, cap: 12 },
  { id: 'wapo-style',        pool: 'sitwith', kind: 'rss', url: 'https://feeds.washingtonpost.com/rss/lifestyle/style', publisher: 'The Washington Post', length: 'none', priority: 2, cap: 12 },
];

export const NEWS_WINDOW_HOURS = 36;
export const SITWITH_WINDOW_DAYS = 7;
// Most any one source can hold in the rolling pool at once (fresh + carried).
// A source's own `cap` overrides it.
export const SITWITH_PER_SOURCE_CAP = 40;
