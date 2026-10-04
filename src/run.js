// A morning run is spread across many small cron ticks instead of one big
// invocation. Two free-plan limits force this: ~10ms CPU and 50 outbound
// fetches per invocation. Each tick does a few sources, saves progress in
// KV under `run:<date>`, and the tick that finishes the last source builds
// the pools. Failed sources are retried on later ticks, up to MAX_ATTEMPTS.

import { SOURCES, NEWS_WINDOW_HOURS, SITWITH_WINDOW_DAYS, SITWITH_PER_SOURCE_CAP } from './sources.js';
import { FETCHERS } from './fetchers.js';

const MAX_ATTEMPTS = 3;
const UNITS_PER_TICK = 4;
const KV_TTL = 60 * 60 * 24 * 45;
const HISTORY_DAYS = 30;
// Cron runs every 5 min from 06:00 to 07:55 UTC. Whatever hasn't finished by
// the last tick gets recorded as failed and the pools are built anyway.
const LAST_TICK_UTC = { h: 7, m: 50 };

export function chicagoDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export function shiftDate(date, days) {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const TRACKING = /^(utm_|smid$|smtyp$|ref$|referrer$|partner$|cmp$|src$|fbclid$|gclid$|mc_|_hs|at_|itm_|intcmp$)/i;

export function canonicalUrl(u) {
  try {
    const x = new URL(u);
    x.hash = '';
    for (const k of [...x.searchParams.keys()]) if (TRACKING.test(k)) x.searchParams.delete(k);
    x.protocol = 'https:';
    return x.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

// Validate one raw item. Every kept item has a real, parseable publication
// time that isn't in the future; anything else is counted, not kept.
function normalize(raw, src, fetchedAt) {
  const url = raw.url && canonicalUrl(raw.url);
  if (!url || !raw.title) return { reason: 'no_url_or_title' };
  const t = Date.parse(raw.rawDate);
  if (!raw.rawDate || Number.isNaN(t)) return { reason: 'undated' };
  if (t > fetchedAt + 60 * 60 * 1000) return { reason: 'bad_date' };
  const item = {
    url,
    title: raw.title,
    published_at: new Date(t).toISOString(),
    source: src.id,
    publisher: src.publisher,
    pool: src.pool,
    priority: src.priority,
    summary: raw.summary || '',
    author: raw.author || '',
    section: raw.section || '',
    word_count: raw.word_count ?? null,
    read_minutes: raw.word_count ? Math.round(raw.word_count / 238) : null,
    fetched_at: new Date(fetchedAt).toISOString(),
  };
  if (raw.via_publisher) item.via_publisher = raw.via_publisher;
  return { item };
}

async function runUnit(src, env, ctx, prev) {
  const started = Date.now();
  const attempts = (prev?.attempts || 0) + 1;
  try {
    const { items: raw, meta } = await FETCHERS[src.kind](src, env, ctx);
    const counts = { fetched: raw.length, valid: 0, undated: 0, bad_date: 0, no_url_or_title: 0 };
    const items = [];
    for (const r of raw) {
      const { item, reason } = normalize(r, src, started);
      if (item) { items.push(item); counts.valid++; } else counts[reason]++;
    }
    return { status: items.length ? 'ok' : 'empty', attempts, ms: Date.now() - started, ...meta, ...counts, items, at: new Date().toISOString() };
  } catch (e) {
    // A missing or rejected key won't fix itself on the next tick.
    const permanent = /^missing /.test(e.message) || e.http === 401;
    return { status: 'error', attempts, ms: Date.now() - started, error: e.message, http: e.http, ...(permanent && { permanent }), items: [], at: new Date().toISOString() };
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function pickBatch(run, all) {
  const pending = SOURCES.filter(s => {
    const u = run.units[s.id];
    return !u || (u.status === 'error' && !u.permanent && u.attempts < MAX_ATTEMPTS);
  }).sort((a, b) => (b.heavy ? 1 : 0) - (a.heavy ? 1 : 0));
  if (all) return pending;
  const batch = [];
  let budget = UNITS_PER_TICK, nyt = 0;
  for (const s of pending) {
    const cost = s.heavy ? UNITS_PER_TICK : 1;
    if (cost > budget || (s.rate === 'nyt' && nyt >= 1)) continue;
    batch.push(s);
    budget -= cost;
    if (s.rate === 'nyt') nyt++;
  }
  return batch;
}

// opts.all: run every pending source now (manual runs and local dry runs);
// NYT calls are still spaced 13s apart to respect 5 calls/min.
export async function tick(env, { now = new Date(), force = false, all = false, scheduled = false } = {}) {
  const kv = env.POOL;
  const date = chicagoDate(now);
  const key = `run:${date}`;
  let run = !force && kv ? await kv.get(key, 'json') : null;
  if (!run) run = { date, started_at: now.toISOString(), ticks: 0, finalized: false, units: {} };
  if (run.finalized) return { date, finalized: true, ran: [] };
  run.ticks++;

  const ctx = { kv, today: date, fromDate: shiftDate(date, -2) };
  const batch = pickBatch(run, all);
  const nytUnits = batch.filter(s => s.rate === 'nyt');
  const others = batch.filter(s => s.rate !== 'nyt');
  const doNyt = (async () => {
    for (let i = 0; i < nytUnits.length; i++) {
      if (i) await sleep(13000);
      run.units[nytUnits[i].id] = await runUnit(nytUnits[i], env, ctx, run.units[nytUnits[i].id]);
    }
  })();
  await Promise.all([doNyt, ...others.map(async s => { run.units[s.id] = await runUnit(s, env, ctx, run.units[s.id]); })]);

  const remaining = pickBatch(run, true).length;
  // Only the scheduled deadline tick forces a finish; manual runs outside the
  // window keep going until every source is done or out of attempts.
  const lastTick = scheduled && now.getUTCHours() === LAST_TICK_UTC.h && now.getUTCMinutes() >= LAST_TICK_UTC.m;
  // Per-source detail is returned directly as well as saved, because KV reads
  // can lag a write by up to a minute.
  const units = Object.fromEntries(batch.map(s => [s.id, unitSummary(run.units[s.id])]));
  let result = { date, ran: batch.map(s => `${s.id}:${run.units[s.id].status}`), remaining, units };
  if (remaining === 0 || lastTick) result = { ...result, ...(await finalize(run, env, now)) };
  if (kv) await kv.put(key, JSON.stringify(run), { expirationTtl: KV_TTL });
  return result;
}

function unitSummary(u) {
  if (!u) return { status: 'not_run' };
  const { items, ...rest } = u;
  return rest;
}

function assemble(run, pool, nowMs, carried) {
  const windowMs = pool === 'news' ? NEWS_WINDOW_HOURS * 36e5 : SITWITH_WINDOW_DAYS * 864e5;
  const cutoff = nowMs - windowMs;
  const sources = {};
  let candidates = [];
  for (const s of SOURCES.filter(s => s.pool === pool)) {
    const u = run.units[s.id];
    let inWindow = (u?.items || []).filter(i => Date.parse(i.published_at) >= cutoff);
    if (pool === 'sitwith') inWindow = inWindow.sort((a, b) => b.published_at.localeCompare(a.published_at)).slice(0, SITWITH_PER_SOURCE_CAP);
    sources[s.id] = { ...unitSummary(u), in_window: inWindow.length, kept: 0 };
    candidates.push(...inWindow);
  }
  // Carried items (yesterday's sit-with pool) lose ties to fresh ones.
  candidates.push(...carried.filter(i => Date.parse(i.published_at) >= cutoff).map(i => ({ ...i, carried: true })));
  candidates.sort((a, b) => a.priority - b.priority || (a.carried ? 1 : 0) - (b.carried ? 1 : 0));

  const byUrl = new Map();
  for (const c of candidates) {
    const hit = byUrl.get(c.url);
    if (hit) {
      if (c.source !== hit.source && !hit.also_in.includes(c.source)) hit.also_in.push(c.source);
      continue;
    }
    const { carried: wasCarried, ...item } = c;
    byUrl.set(c.url, { ...item, also_in: (item.also_in || []).filter(x => x !== item.source) });
  }
  const items = [...byUrl.values()].sort((a, b) => b.published_at.localeCompare(a.published_at));
  for (const i of items) if (sources[i.source]) sources[i.source].kept++;
  return { items, sources };
}

async function finalize(run, env, now) {
  const kv = env.POOL;
  const nowMs = now.getTime();
  const date = run.date;

  let carried = [];
  if (kv) {
    for (let d = 1; d <= SITWITH_WINDOW_DAYS && !carried.length; d++) {
      const prev = await kv.get(`sitwith:${shiftDate(date, -d)}`, 'json');
      if (prev?.items) carried = prev.items;
    }
  }

  const news = assemble(run, 'news', nowMs, []);
  const sitwith = assemble(run, 'sitwith', nowMs, carried);
  const generated_at = now.toISOString();
  const newsDoc = { date, generated_at, window_hours: NEWS_WINDOW_HOURS, count: news.items.length, items: news.items, sources: news.sources };
  const sitDoc = { date, generated_at, window_days: SITWITH_WINDOW_DAYS, count: sitwith.items.length, items: sitwith.items, sources: sitwith.sources };

  // Per-source history, keyed by date so a re-run on the same day overwrites
  // instead of double counting. ok/failed counts are derived from it.
  const stats = (kv && (await kv.get('stats', 'json'))) || {};
  const cutoffDate = shiftDate(date, -HISTORY_DAYS);
  for (const id of Object.keys(stats)) if (!SOURCES.some(s => s.id === id)) delete stats[id];
  for (const s of SOURCES) {
    const u = run.units[s.id];
    const st = (stats[s.id] ||= { history: {} });
    st.history[date] = u ? (u.status === 'error' ? `error: ${u.error}` : u.status) : 'not_run';
    for (const d of Object.keys(st.history)) if (d < cutoffDate) delete st.history[d];
    const days = Object.entries(st.history).sort(([a], [b]) => b.localeCompare(a));
    st.ok = days.filter(([, v]) => v === 'ok').length;
    st.failed = days.filter(([, v]) => v !== 'ok').length;
    st.consecutive_failures = days.findIndex(([, v]) => v === 'ok');
    if (st.consecutive_failures === -1) st.consecutive_failures = days.length;
    st.last_status = st.history[date];
  }

  run.finalized = true;
  run.finalized_at = generated_at;
  const failing = SOURCES.filter(s => (run.units[s.id]?.status ?? 'not_run') !== 'ok').map(s => `${s.id}:${run.units[s.id]?.status ?? 'not_run'}`);
  if (kv) {
    await Promise.all([
      kv.put(`news:${date}`, JSON.stringify(newsDoc), { expirationTtl: KV_TTL }),
      kv.put(`sitwith:${date}`, JSON.stringify(sitDoc), { expirationTtl: KV_TTL }),
      kv.put('stats', JSON.stringify(stats)),
      kv.put('latest', JSON.stringify({ date, generated_at, news: newsDoc.count, sitwith: sitDoc.count, failing })),
    ]);
  }
  return { finalized: true, news: newsDoc.count, sitwith: sitDoc.count, failing, newsDoc, sitDoc };
}
