// One fetcher per source kind. Each returns { items, meta } where items have
// a raw date that run.js validates; nothing here decides what to keep.
// Errors are thrown, never swallowed — run.js records them per source.

import { parseFeed, stripHtml, decodeEntities } from './feed.js';

const UA = 'Mozilla/5.0 (compatible; morning-briefing/1.0; +https://github.com/clints81/morning-briefing-retrieval)';

async function get(url, accept) {
  const r = await fetch(url, { headers: { 'user-agent': UA, accept }, redirect: 'follow' });
  if (!r.ok) {
    // Include the server's own explanation (e.g. NYT's faultstring), which
    // is what tells a bad key apart from an API not enabled for that key.
    const body = (await r.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
    const err = new Error(`HTTP ${r.status}${body && !body.startsWith('<') ? ': ' + body : ''}`);
    err.http = r.status;
    throw err;
  }
  return r.text();
}

const XML = 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5';

async function rss(src, url = src.url) {
  const items = parseFeed(await get(url, XML));
  return { items, meta: { via: 'rss' } };
}

async function nytTop(src, env) {
  if (!env.NYT_API_KEY) throw new Error('missing NYT_API_KEY');
  const j = JSON.parse(await get(`https://api.nytimes.com/svc/topstories/v2/${src.section}.json?api-key=${env.NYT_API_KEY}`, 'application/json'));
  const items = (j.results || [])
    .filter(r => r.url && r.title && r.item_type !== 'Promo')
    .map(r => ({
      title: r.title, url: r.url, rawDate: r.published_date, summary: r.abstract || '',
      author: (r.byline || '').replace(/^By\s+/i, ''), section: [r.section, r.subsection].filter(Boolean).join(' / '),
      word_count: null,
    }));
  return { items, meta: { via: 'api' } };
}

async function guardian(src, env, ctx) {
  if (!env.GUARDIAN_API_KEY) throw new Error('missing GUARDIAN_API_KEY');
  const params = new URLSearchParams({
    ...src.query,
    'order-by': 'newest',
    'page-size': '50',
    'from-date': ctx.fromDate,
    'show-fields': 'trailText,wordcount,byline',
    'api-key': env.GUARDIAN_API_KEY,
  });
  const j = JSON.parse(await get(`https://content.guardianapis.com/search?${params}`, 'application/json'));
  const results = j.response?.results || [];
  const skipped = {};
  for (const r of results) if (r.type !== 'article' && r.type !== 'interactive') skipped[r.type] = (skipped[r.type] || 0) + 1;
  const items = results
    // Some features are 'interactive' pages; podcasts, live blogs and galleries are skipped.
    .filter(r => r.type === 'article' || r.type === 'interactive')
    .map(r => ({
      title: r.webTitle, url: r.webUrl, rawDate: r.webPublicationDate,
      summary: stripHtml(r.fields?.trailText || ''), author: r.fields?.byline || '', section: r.sectionName || '',
      word_count: r.fields?.wordcount ? Number(r.fields.wordcount) : null,
    }));
  return { items, meta: { via: 'api', ...(Object.keys(skipped).length && { skipped_types: skipped }) } };
}

// Arts & Letters Daily's feed has no dates and links out to other
// publications. For each link we haven't seen before, fetch the target page
// and read its own published date. Resolved dates are cached in KV
// (`aldaily:seen`), so after the first day only the 2–4 new links get fetched.
const ALD_MAX_PAGE_FETCHES = 12;

function pageDate(html) {
  const pats = [
    /"datePublished"\s*:\s*"([^"]+)"/,
    /<meta[^>]+(?:property|name)=["'](?:article:published_time|og:published_time|pubdate|publish-date|date|dc\.date|parsely-pub-date)["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:article:published_time|og:published_time|pubdate|parsely-pub-date)["']/i,
    /<time[^>]+datetime=["']([^"']+)["']/i,
  ];
  for (const p of pats) {
    const m = html.match(p);
    if (m && !Number.isNaN(Date.parse(m[1]))) return m[1];
  }
  return '';
}

async function aldaily(src, env, ctx) {
  const items = parseFeed(await get(src.url, XML));
  const seen = (ctx.kv && (await ctx.kv.get('aldaily:seen', 'json'))) || {};
  let fetched = 0, unresolved = 0;
  for (const it of items) {
    it.blurb = it.summary;
    try { it.via_publisher = new URL(it.url).hostname.replace(/^www\./, ''); } catch {}
    if (seen[it.url]) { it.rawDate = seen[it.url].date; continue; }
    if (fetched >= ALD_MAX_PAGE_FETCHES) { unresolved++; continue; }
    fetched++;
    try {
      const html = await get(it.url, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5');
      it.rawDate = pageDate(html);
      const t = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
      if (t) it.title = decodeEntities(t[1]).trim();
      if (it.rawDate) seen[it.url] = { date: it.rawDate, at: ctx.today };
      else unresolved++;
    } catch (e) {
      unresolved++;
      it.page_error = e.message;
    }
  }
  // Forget links older than 30 days so the cache stays small.
  const cutoff = Date.now() - 30 * 864e5;
  for (const [u, v] of Object.entries(seen)) if (Date.parse(v.at) < cutoff) delete seen[u];
  if (ctx.kv) await ctx.kv.put('aldaily:seen', JSON.stringify(seen));
  return { items, meta: { via: 'rss + page fetch', page_fetches: fetched, unresolved_dates: unresolved } };
}

export const FETCHERS = { rss: src => rss(src), 'nyt-top': nytTop, guardian, aldaily };
