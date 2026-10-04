// Read length for sit-with items whose feed didn't include one. Each source
// declares a `length` method in sources.js:
//
//   'page'       fetch the article; use its metadata wordCount, else count text
//   'page-text'  fetch the article; count text only (Wired's metadata wordCount
//                is a placeholder: 1100 on every article)
//   'nyt-search' NYT Article Search API's word_count (nytimes.com pages 403).
//                The API can't filter by URL (tested 2026-10-04: web_url
//                filters return 0 hits), so each item is looked up by headline
//                phrase and kept only if a result's URL matches exactly.
//   'none'       don't try (e.g. The Atlantic: its RSS carries full text)
//
// Results land in KV under `lengths` (url → {words, via, at, tries}), so an
// article is measured once and carried items keep their length. A miss is
// retried on a later day, since Article Search can lag new articles by hours.

import { get } from './fetchers.js';
import { stripHtml, canonicalUrl } from './feed.js';

const MIN_TEXT_WORDS = 150; // below this, the page is a paywall teaser
const RETRY_AFTER_MS = 6 * 36e5;
const MAX_TRIES = 3;
const KEEP_DAYS = 10;

const countWords = s => s.split(/\s+/).filter(Boolean).length;

export function pageWords(html, method) {
  if (method === 'page') {
    const m = html.match(/"wordCount"\s*:\s*"?(\d+)/);
    if (m) return { words: Number(m[1]), via: 'page-meta' };
  }
  const body = html.match(/"articleBody"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  let words = body ? countWords(body[1]) : 0;
  if (!words) {
    // Count paragraphs inside <article> when there is one, so navigation and
    // footer text don't inflate the count. Some sites (Comment) use <article>
    // for a small card instead, so fall back to the whole page.
    const pWords = region => {
      let n = 0;
      for (const m of region.matchAll(/<p[\s>][\s\S]*?<\/p>/gi)) n += countWords(stripHtml(m[0]));
      return n;
    };
    const a = html.indexOf('<article'), b = html.lastIndexOf('</article>');
    if (a >= 0 && b > a) words = pWords(html.slice(a, b));
    if (words < MIN_TEXT_WORDS) words = pWords(html);
  }
  return words >= MIN_TEXT_WORDS ? { words, via: 'page-text' } : { words: null, via: 'page-text', note: 'too little text' };
}

async function nytLookup(item, env) {
  if (!env.NYT_API_KEY) throw new Error('missing NYT_API_KEY');
  const phrase = item.title.replace(/["“”]/g, ' ').replace(/\s+/g, ' ').trim();
  const j = JSON.parse(await get(`https://api.nytimes.com/svc/search/v2/articlesearch.json?q=${encodeURIComponent(`"${phrase}"`)}&api-key=${env.NYT_API_KEY}`, 'application/json'));
  const doc = (j.response?.docs || []).find(d => d.web_url && canonicalUrl(d.web_url) === item.url);
  return doc?.word_count ? { words: doc.word_count, via: 'nyt-search' } : { note: 'not in Article Search' };
}

export function needsLength(item, method, cached, nowMs) {
  if (item.word_count != null || !method || method === 'none') return false;
  if (!cached) return true;
  if (cached.words != null) return false;
  return cached.tries < MAX_TRIES && nowMs - Date.parse(cached.at) > RETRY_AFTER_MS;
}

// Measure up to `pageBudget` pages and `nytCalls` Article Search calls.
// Returns a summary for the run record; mutates `lengths`.
export async function measure(jobs, lengths, env, { pageBudget, nytCalls, sleep }) {
  const at = new Date().toISOString();
  const record = (url, method, res) => {
    const tries = (lengths[url]?.tries || 0) + 1;
    lengths[url] = { words: res.words ?? null, via: res.via || method, at, tries, ...(res.error && { error: res.error }), ...(res.note && { note: res.note }) };
  };
  const summary = { pages: 0, nyt_calls: 0, measured: 0, missed: 0, errors: {} };

  const pageJobs = jobs.filter(j => j.method === 'page' || j.method === 'page-text').slice(0, pageBudget);
  await Promise.all(pageJobs.map(async j => {
    summary.pages++;
    try {
      record(j.item.url, j.method, pageWords(await get(j.item.url, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5'), j.method));
    } catch (e) {
      // Hitting the Worker's own fetch limit says nothing about the page.
      if (!/too many subrequests/i.test(e.message)) record(j.item.url, j.method, { error: e.message });
      summary.errors[j.item.source] = e.message;
    }
  }));

  // One call per item, 13s apart (NYT allows 5 calls/min).
  const nytJobs = jobs.filter(j => j.method === 'nyt-search').slice(0, nytCalls);
  for (let c = 0; c < nytJobs.length; c++) {
    if (c) await sleep(13000);
    summary.nyt_calls++;
    try {
      record(nytJobs[c].item.url, 'nyt-search', await nytLookup(nytJobs[c].item, env));
    } catch (e) {
      // Rate-limited: leave unrecorded so the next tick tries again.
      if (e.http !== 429) record(nytJobs[c].item.url, 'nyt-search', { error: e.message });
      summary.errors['nyt-search'] = e.message;
    }
  }

  for (const j of [...pageJobs, ...nytJobs]) {
    const r = lengths[j.item.url];
    if (r?.at === at) r.words != null ? summary.measured++ : summary.missed++;
  }
  const cutoff = Date.now() - KEEP_DAYS * 864e5;
  for (const [u, v] of Object.entries(lengths)) if (Date.parse(v.at) < cutoff) delete lengths[u];
  return summary;
}
