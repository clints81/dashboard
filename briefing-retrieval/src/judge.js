// The judgment step: turns tonight's pools into the morning briefing.
//
// Runs on cron ticks after the pools are built (never in the same
// invocation as source fetches). The request goes through the Batch API at
// half price: one tick submits, later ticks collect. If the batch isn't
// back by the cutoff, it's cancelled and the request is made directly at
// full price. The model picks and writes; the Worker verifies every pick
// against the pool, chooses links, and publishes. See DESIGN.md.
//
//   brief:<date>  the edition, its verification record, delivery status,
//                 and the comparison model's edition when one is set
//   storylog      the last 7 days of published story labels (fatigue)
//
// PUBLISH="on" sends the edition to the dashboard Worker, KV storylog and
// the Notion logs. Anything else is shadow mode: brief:<date> only.

import Anthropic from '@anthropic-ai/sdk';
import { chicagoDate, shiftDate } from './run.js';
import { NEWS_WINDOW_HOURS } from './sources.js';
import { readStoryLog, readDeepDiveLog, appendStoryLog, appendDeepDiveLog } from './notion.js';

const DEFAULT_MODEL = 'claude-opus-5-5';
// Standard $ per million tokens [input, output]; the Batch API is half.
export const PRICES = { 'claude-opus-5-5': [4, 20], 'claude-sonnet-5-5': [2, 10] };
const EFFORT = 'medium';
const MAX_TOKENS = 32000;
const KV_TTL = 60 * 60 * 24 * 45;
const MAX_SUBMITS = 3;
const MAX_DIRECT = 2;
const MAX_DELIVERY_ATTEMPTS = 3;
// A direct call still marked running after this long died with its invocation.
const STALE_MS = 15 * 60 * 1000;
// Cron runs 06:00–09:55 UTC. A batch not back by the cutoff is cancelled
// and the request made directly; by the deadline, a status-only edition
// replaces yesterday's. 09:30 UTC is 4:30am CDT / 3:30am CST.
const CUTOFF_UTC = { h: 9, m: 30 };
const DEADLINE_UTC = { h: 9, m: 50 };
const LOG_DAYS = 7;
const DEEP_DIVE_DAYS = 28;
const MIN_SIT_MINUTES = 8;
const MIN_LONG_READ_MINUTES = 20;
const DASHBOARD_URL = 'https://briefing.clintsievers.workers.dev/';
const NYT = 'The New York Times';

export const CATEGORIES = ['Politics', 'World', 'Business', 'Technology', 'Culture', 'Religion', 'Science', 'Sports'];
export const FLOOR = ['Technology', 'Science', 'Religion'];
// main: the section that defines the edition, with its [min, max]. Below
// min the edition is published as partial. stories: the fresh-story max
// (weekend floor stories don't count toward it).
export const EDITIONS = {
  weekday: { main: 'stories', range: [10, 12], stories: 12 },
  saturday: { main: 'threads', range: [5, 7], stories: 3 },
  sunday: { main: 'ahead', range: [5, 7], stories: 3 },
};

export function editionFor(date) {
  const d = new Date(date + 'T12:00:00Z');
  const day = d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  const long = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const edition = day === 'Saturday' ? 'saturday' : day === 'Sunday' ? 'sunday' : 'weekday';
  // The Notion story log keeps the old two-value edition names.
  return { edition, logEdition: edition === 'weekday' ? 'weekday' : 'weekend', day, long };
}

const oneLine = s => String(s || '').replace(/\s+/g, ' ').trim();
const normTitle = s => oneLine(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

// ── Context: story log, deep-dive log, the week's briefings ──────────────

// Fatigue reads KV. Until KV holds a full week (the first week after
// cutover, and all of shadow mode), missing days come from Notion. A day
// still missing (in shadow mode, a day Cowork failed and logged nothing)
// comes from the Worker's own edition for that day, so its repeats count.
export async function loadHistory(env, date) {
  const since = shiftDate(date, -LOG_DAYS);
  const kvEntries = (env.POOL && (await env.POOL.get('storylog', 'json'))?.entries) || [];
  const entries = kvEntries.filter(e => e.date >= since && e.date < date);
  const oldest = kvEntries.map(e => e.date).sort()[0];
  let source = 'kv', notion_error = null;
  if (!oldest || oldest > since) {
    try {
      const have = new Set(entries.map(e => e.date));
      entries.push(...(await readStoryLog(env, since)).filter(e => e.date < date && !have.has(e.date)));
      source = kvEntries.length ? 'kv+notion' : 'notion';
    } catch (e) {
      notion_error = e.message;
    }
  }
  const have = new Set(entries.map(e => e.date));
  const missing = Array.from({ length: LOG_DAYS }, (_, i) => shiftDate(date, -(i + 1))).filter(d => !have.has(d));
  const own = env.POOL ? await Promise.all(missing.map(d => env.POOL.get(`brief:${d}`, 'json'))) : [];
  const filled = own.map((b, i) => b?.state === 'done' && b.stories && { ...logEntry(b), date: missing[i] }).filter(Boolean);
  if (filled.length) {
    entries.push(...filled);
    source += ` + own editions (${filled.map(e => e.date.slice(5)).join(', ')})`;
  }
  entries.sort((a, b) => a.date.localeCompare(b.date));
  return { entries, source, notion_error };
}

// What Clint was shown Sunday–Friday, for Saturday's recap: the Worker's
// published edition, else Cowork's (snapshotted daily for /compare), else
// the Worker's shadow edition.
async function loadWeek(env, date) {
  const items = [];
  for (let i = 6; i >= 1; i--) {
    const d = shiftDate(date, -i);
    const [b, cw] = await Promise.all([env.POOL.get(`brief:${d}`, 'json'), env.POOL.get(`cowork:${d}`, 'json')]);
    const ours = b?.state === 'done' && b.stories?.length ? b.stories.map(s => ({ title: s.title, summary: s.summary, category: s.category, url: s.url, publisher: s.link_publisher })) : null;
    const theirs = cw?.headlines?.length ? cw.headlines.map(h => ({ title: h.title, summary: h.summary, category: h.category, url: h.url, publisher: host(h.url) === 'nytimes.com' ? NYT : host(h.url) })) : null;
    const pick = (b?.publish && ours) || theirs || ours || [];
    items.push(...pick.map(x => ({ ...x, date: d })));
  }
  return items;
}

export async function gatherContext(env, date) {
  const { edition } = editionFor(date);
  const h = await loadHistory(env, date);
  const ctx = { history: h.entries, log_source: h.source, notion_errors: h.notion_error ? [`story log: ${h.notion_error}`] : [], deep_dive: [], week: [] };
  if (edition === 'sunday') {
    try {
      ctx.deep_dive = (await readDeepDiveLog(env, shiftDate(date, -DEEP_DIVE_DAYS))).map(e => ({ date: e.date, label: e.labels[0] || '' }));
    } catch (e) {
      ctx.notion_errors.push(`deep-dive log: ${e.message}`);
    }
  }
  if (edition === 'saturday') ctx.week = await loadWeek(env, date);
  return ctx;
}

// ── Model input ──────────────────────────────────────────────────────────

const ageHours = (item, refMs) => Math.max(0, Math.round((refMs - Date.parse(item.published_at)) / 36e5));

// Items get short IDs so the model cites items, never URLs. IDs are
// assigned over the full pools, so the same docs always give the same IDs.
export function indexPools(newsDoc, sitDoc, week = []) {
  const byId = new Map();
  (newsDoc?.items || []).forEach((it, i) => byId.set(`N${i + 1}`, it));
  (sitDoc?.items || []).forEach((it, i) => byId.set(`S${i + 1}`, it));
  week.forEach((it, i) => byId.set(`W${i + 1}`, it));
  return byId;
}

function recommended(ctx) {
  const urls = new Set(ctx.history.map(e => e.sit_with?.url).filter(Boolean));
  const titles = new Set(ctx.history.map(e => e.sit_with && normTitle(e.sit_with.title)).filter(Boolean));
  return it => urls.has(it.url) || titles.has(normTitle(it.title));
}

// The sit-with pool sent to the model: no piece measured under 8 minutes,
// nothing already recommended this week.
function sitEligible(ctx) {
  const seen = recommended(ctx);
  return it => (it.read_minutes == null || it.read_minutes >= MIN_SIT_MINUTES) && !seen(it);
}

export function buildInput({ date, byId, ctx, refMs, poolBuiltAt }) {
  const { edition, long } = editionFor(date);
  const lines = (prefix, keep = () => true) => {
    const out = [];
    let n = 0;
    for (const [id, it] of byId) {
      if (!id.startsWith(prefix) || !keep(it)) continue;
      n++;
      const len = it.read_minutes != null ? ` | ${it.read_minutes} min` : '';
      const by = prefix === 'S' && it.author ? ` | by ${oneLine(it.author)}` : '';
      out.push(`${id} | ${ageHours(it, refMs)}h ago | ${it.publisher} | ${it.section || '-'} | ${oneLine(it.title)}${len}${by}`);
      if (it.summary) out.push(`    ${oneLine(it.summary)}`);
    }
    return { text: out.join('\n') || '(empty)', n };
  };
  const log = ctx.history.length
    ? ctx.history.map(e => `${e.date} ${e.day} (${e.edition}): ${e.labels.join('; ') || '(no stories)'}`).join('\n')
    : '(no entries: treat every topic as new)';
  const sits = ctx.history.filter(e => e.sit_with).map(e => `${e.date}: ${e.sit_with.title}`);
  const news = lines('N');
  const sit = lines('S', sitEligible(ctx));
  const built = poolBuiltAt ? new Date(poolBuiltAt).toLocaleString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }) + ' Central' : 'tonight';
  const parts = [
    `Tonight's edition: ${edition} (${long}).\nToday's date: ${date}. Pool built at ${built}; ages below are hours before that.`,
    `## Story log, past ${LOG_DAYS} days\n${log}`,
    `## Sit-with picks already recommended\n${sits.join('\n') || '(none)'}`,
  ];
  if (edition === 'sunday') parts.push(`## Long reads recommended in the last ${DEEP_DIVE_DAYS} days\n${ctx.deep_dive.map(e => `${e.date}: ${e.label}`).join('\n') || '(none)'}`);
  if (edition === 'saturday') {
    const week = [...byId].filter(([id]) => id[0] === 'W').map(([id, w]) => `${id} | ${w.date} | ${w.category} | ${oneLine(w.title)}\n    ${oneLine(w.summary)}`);
    parts.push(`## This week's briefings\n${week.join('\n') || '(none recorded)'}`);
  }
  parts.push(`## News pool (${news.n} items, last ${NEWS_WINDOW_HOURS} hours)\n${news.text}`);
  parts.push(`## Sit-with pool (${sit.n} items, last 7 days)\n${sit.text}`);
  return parts.join('\n\n');
}

// ── Output schema ────────────────────────────────────────────────────────

const str = { type: 'string' };
const ids = { type: 'array', items: str };
const cat = { type: 'string', enum: CATEGORIES };
const obj = props => ({ type: 'object', properties: props, required: Object.keys(props), additionalProperties: false });
// One schema for every edition (unused arrays come back empty), so the
// compiled schema stays cached across nights.
export const SCHEMA = obj({
  threads: { type: 'array', items: obj({ category: cat, title: str, summary: str, item_ids: ids, coverage_note: str }) },
  ahead: { type: 'array', items: obj({ category: cat, title: str, when: str, summary: str, item_ids: ids }) },
  stories: { type: 'array', items: obj({ category: cat, title: str, summary: str, item_ids: ids, floor: { type: 'boolean' }, log_label: str, continues_label: str, whats_new: str }) },
  sit_with: { anyOf: [obj({ item_id: str, type: str, desc: str, label: str }), { type: 'null' }] },
  floor_check: { type: 'array', items: obj({ category: { type: 'string', enum: FLOOR }, status: { type: 'string', enum: ['included', 'none_fresh'] }, note: str }) },
  synthesis: str,
  notes: str,
});

// ── Calls ────────────────────────────────────────────────────────────────

function client(env) {
  if (!env.ANTHROPIC_API_KEY) throw Object.assign(new Error('missing ANTHROPIC_API_KEY'), { permanent: true });
  // Non-streaming on purpose: the free plan allows ~10ms CPU per
  // invocation, and one JSON body is far cheaper to parse than a stream.
  // The explicit timeout is what lets the SDK accept a large max_tokens
  // without streaming. Retries happen on later cron ticks.
  // A key not scoped to a workspace must name one on every request.
  const defaultHeaders = env.ANTHROPIC_WORKSPACE_ID ? { 'anthropic-workspace-id': env.ANTHROPIC_WORKSPACE_ID } : undefined;
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 0, timeout: 13 * 60 * 1000, defaultHeaders });
}

const params = (model, system, input) => ({
  model, max_tokens: MAX_TOKENS, thinking: { type: 'adaptive' },
  output_config: { effort: EFFORT, format: { type: 'json_schema', schema: SCHEMA } },
  system, messages: [{ role: 'user', content: input }],
});

function cost(model, usage, batch) {
  const [pin, pout] = PRICES[model] || PRICES[DEFAULT_MODEL];
  return Math.round(((usage.input_tokens * pin + usage.output_tokens * pout) / 1e6) * (batch ? 0.5 : 1) * 1000) / 1000;
}

export function parseMessage(msg, { batch }) {
  const usage = { model: msg.model, via: batch ? 'batch' : 'direct', input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens, cost_usd: cost(msg.model, msg.usage, batch) };
  if (msg.stop_reason === 'refusal') throw Object.assign(new Error(`model declined (${msg.stop_details?.category ?? 'no category'})`), { usage });
  if (msg.stop_reason === 'max_tokens') throw Object.assign(new Error('output hit max_tokens'), { usage });
  const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
  try {
    return { out: JSON.parse(text), usage };
  } catch {
    throw Object.assign(new Error(`unparseable output (${text.length} chars)`), { usage });
  }
}

// Direct call, full price. The Batch API doesn't take `fallbacks`; here a
// safety decline re-runs on Anthropic's recommended fallback model.
export async function callDirect(env, model, system, input) {
  const t0 = Date.now();
  const msg = await client(env).beta.messages.create({ ...params(model, system, input), betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
  const r = parseMessage(msg, { batch: false });
  r.usage.seconds = Math.round((Date.now() - t0) / 1000);
  return r;
}

async function submitBatch(env, models, system, input) {
  const b = await client(env).messages.batches.create({ requests: models.map((m, i) => ({ custom_id: i ? 'compare' : 'primary', params: params(m, system, input) })) });
  return b.id;
}

// Returns null while processing, else { primary, compare } with a parsed
// result or an error for each.
async function collectBatch(env, id) {
  const c = client(env);
  const b = await c.messages.batches.retrieve(id);
  if (b.processing_status !== 'ended') return null;
  const got = {};
  for await (const r of await c.messages.batches.results(id)) {
    if (r.result.type !== 'succeeded') {
      got[r.custom_id] = { error: `batch ${r.result.type}${r.result.error ? `: ${JSON.stringify(r.result.error.error ?? r.result.error)}` : ''}` };
      continue;
    }
    try {
      got[r.custom_id] = parseMessage(r.result.message, { batch: true });
    } catch (e) {
      got[r.custom_id] = { error: e.message, usage: e.usage };
    }
  }
  return got;
}

// ── Verification ─────────────────────────────────────────────────────────

// Everything the model returned is checked against the request here. What
// fails is dropped and recorded in `problems`; nothing is filled in.
// refMs is when the pool was built: the 36-hour window is measured from there.
export function verify(out, { byId, date, refMs, ctx }) {
  const { edition } = editionFor(date);
  const cfg = EDITIONS[edition];
  const problems = [];
  const used = new Set();
  const fresh = it => it.published_at && refMs - Date.parse(it.published_at) <= NEWS_WINDOW_HOURS * 36e5;
  const ref = (id, it) => ({ id, title: it.title, publisher: it.publisher, url: it.url, published_at: it.published_at ?? null, ...(it.date && { shown_on: it.date }) });
  // Prefer the Times when it has the story; otherwise the model's lead item.
  const link = items => items.find(it => it.publisher === NYT) || items[0];

  // Resolve an entry's IDs. allow: the ID prefixes it may cite.
  const resolve = (e, allow) => {
    const uniq = [...new Set(e.item_ids)];
    const fits = id => byId.has(id) && allow.includes(id[0]);
    const bad = uniq.filter(id => !fits(id));
    const dup = uniq.filter(id => fits(id) && used.has(id));
    const ok = uniq.filter(id => fits(id) && !used.has(id));
    if (bad.length) problems.push(`"${e.title}": ${bad.join(', ')} not in the request or not allowed here, ignored`);
    if (dup.length) problems.push(`"${e.title}": ${dup.join(', ')} already used elsewhere, ignored`);
    if (!ok.length) problems.push(`dropped "${e.title}": nothing in the request behind it`);
    return ok;
  };
  // counts: which entries count toward max. keep: entries never trimmed
  // (the last-added others go first).
  const capTo = (list, max, name, { counts = () => true, keep = () => false } = {}) => {
    while (list.filter(counts).length > max) {
      const i = list.findLastIndex(x => counts(x) && !keep(x));
      if (i < 0) break;
      problems.push(`trimmed "${list[i].title}": over the ${name} maximum of ${max}`);
      list.splice(i, 1);
    }
    return list;
  };
  const sortByTopic = list => list.map((s, i) => ({ s, i })).sort((a, b) => CATEGORIES.indexOf(a.s.category) - CATEGORIES.indexOf(b.s.category) || a.i - b.i).map(x => x.s);

  // The edition's main section goes first, so it keeps an item over a
  // fresh story (Rule A).
  const threads = [];
  if (edition === 'saturday') {
    for (const t of out.threads || []) {
      const ok = resolve(t, 'WNS');
      if (!ok.length) continue;
      ok.forEach(id => used.add(id));
      const l = link(ok.map(id => byId.get(id)));
      threads.push({ category: t.category, title: oneLine(t.title), summary: oneLine(t.summary), coverage_note: oneLine(t.coverage_note), url: l.url, link_publisher: l.publisher, items: ok.map(id => ref(id, byId.get(id))) });
    }
    capTo(threads, cfg.range[1], 'thread');
  } else if (out.threads?.length) problems.push(`ignored ${out.threads.length} threads: Saturday only`);

  const ahead = [];
  if (edition === 'sunday') {
    for (const a of out.ahead || []) {
      if (!oneLine(a.when)) { problems.push(`dropped "${a.title}": no timing given`); continue; }
      const ok = resolve(a, 'NS');
      if (!ok.length) continue;
      ok.forEach(id => used.add(id));
      const l = link(ok.map(id => byId.get(id)));
      ahead.push({ category: a.category, title: oneLine(a.title), when: oneLine(a.when), summary: oneLine(a.summary), url: l.url, link_publisher: l.publisher, items: ok.map(id => ref(id, byId.get(id))) });
    }
    capTo(ahead, cfg.range[1], 'look-ahead');
  } else if (out.ahead?.length) problems.push(`ignored ${out.ahead.length} look-ahead items: Sunday only`);

  const covered = c => [...threads, ...ahead].some(x => x.category === c);
  let stories = [];
  for (const s of out.stories || []) {
    const ok = resolve(s, 'NS');
    if (!ok.length) continue;
    const items = ok.map(id => byId.get(id));
    let floor = !!s.floor;
    if (floor && !FLOOR.includes(s.category)) { problems.push(`"${s.title}": floor flag on ${s.category} removed`); floor = false; }
    if (!items.some(fresh)) {
      // Stale items may back only the floor pick for an uncovered category.
      const isFloorPick = FLOOR.includes(s.category) && !covered(s.category) && !stories.some(x => x.category === s.category);
      if (!isFloorPick) { problems.push(`dropped "${s.title}": no item from the last ${NEWS_WINDOW_HOURS}h`); continue; }
      floor = true;
    }
    ok.forEach(id => used.add(id));
    const l = link(items);
    stories.push({
      category: s.category, title: oneLine(s.title), summary: oneLine(s.summary), floor, log_label: oneLine(s.log_label),
      continues_label: oneLine(s.continues_label), whats_new: oneLine(s.whats_new),
      url: l.url, link_publisher: l.publisher, items: ok.map(id => ref(id, byId.get(id))),
    });
  }
  // On weekdays every story counts toward 12, but a floor category's only
  // story is never the one trimmed. Weekend floor stories sit outside the
  // 0–3 fresh stories.
  const onlyOfFloorCat = x => FLOOR.includes(x.category) && stories.filter(y => y.category === x.category).length === 1;
  stories = sortByTopic(capTo(stories, cfg.stories, 'story', edition === 'weekday' ? { keep: onlyOfFloorCat } : { counts: x => !x.floor }));

  // Sit-with pick (on Sunday, the long read).
  let sit_with = null;
  const sw = out.sit_with;
  if (sw) {
    const it = byId.get(sw.item_id);
    const longRead = edition === 'sunday';
    const min = longRead ? MIN_LONG_READ_MINUTES : MIN_SIT_MINUTES;
    const why = !it || sw.item_id[0] !== 'S' ? `${sw.item_id} is not a sit-with pool item`
      : used.has(sw.item_id) ? 'also cited elsewhere (Rule A)'
      : recommended(ctx)(it) ? 'already recommended this week'
      : it.read_minutes != null && it.read_minutes < min ? `only ${it.read_minutes} min`
      : null;
    if (why) problems.push(`sit-with ${sw.item_id} rejected: ${why}`);
    else sit_with = {
      type: oneLine(sw.type), headline: oneLine(it.title), desc: oneLine(sw.desc), source: it.publisher,
      read_time: it.read_minutes != null ? `~${it.read_minutes} min` : 'length not measured', url: it.url,
      label: oneLine(sw.label), long_read: longRead, item: ref(sw.item_id, it),
    };
  }

  // Floor accounting across the whole edition. The Worker can't judge
  // freshness, so a category skipped without a none_fresh report is
  // recorded, not filled.
  const floor = {};
  for (const c of FLOOR) {
    const st = stories.find(s => s.category === c);
    const fc = (out.floor_check || []).find(f => f.category === c);
    floor[c] = covered(c) ? (edition === 'saturday' ? 'week thread' : 'look-ahead') : st ? (st.floor ? 'floor pick' : 'on merit') : fc?.status === 'none_fresh' ? `none fresh: ${oneLine(fc.note)}` : 'MISSED';
    if (floor[c] === 'MISSED') problems.push(`floor missed: no ${c} item and no none_fresh report`);
  }

  const n = { stories, threads, ahead }[cfg.main].length;
  const [min, max] = cfg.range;
  const status = n >= min ? 'ok' : 'partial';
  const status_line = status === 'ok' ? ''
    : edition === 'sunday' ? `Light week ahead: ${n} ${n === 1 ? 'item' : 'items'} could be confirmed in tonight's sources.`
    : edition === 'saturday' ? `Partial edition: ${n} ${n === 1 ? 'thread' : 'threads'} from the week cleared verification, short of the usual ${min}–${max}.`
    : `Partial edition: ${n} ${n === 1 ? 'story' : 'stories'} cleared verification tonight, short of the usual ${min}–${max}.`;
  return { edition, status, status_line, threads, ahead, stories, sit_with, floor, problems, synthesis: oneLine(out.synthesis), notes: oneLine(out.notes), floor_check: out.floor_check || [] };
}

// ── Dashboard payload ────────────────────────────────────────────────────

// The dashboard inserts title, summary, category and synthesis with
// innerHTML, and the URL inside onclick="window.open('…')". sit_with uses
// textContent, so it goes raw.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeUrl = u => String(u).replace(/'/g, '%27').replace(/"/g, '%22').replace(/</g, '%3C').replace(/>/g, '%3E');

export function toDashboard(date, v) {
  const { day } = editionFor(date);
  const weekend = v.edition !== 'weekday';
  const h = (category, title, summary, url) => ({ title: esc(title), summary: esc(summary), category: esc(category), url: safeUrl(url) });
  const headlines = [
    ...v.threads.map(t => h(`Week · ${t.category}`, t.title, t.summary, t.url)),
    ...v.ahead.map(a => h(`Ahead · ${a.category}`, a.title, `${a.when}: ${a.summary}`, a.url)),
    ...v.stories.map(s => h([weekend && 'New', s.category, s.floor && 'floor'].filter(Boolean).join(' · '), s.title, s.summary, s.url)),
  ];
  const body = { date, day, synthesis: esc([v.status_line, v.synthesis].filter(Boolean).join(' ')), headlines };
  if (v.sit_with) {
    const { type, headline, desc, source, read_time, url, long_read } = v.sit_with;
    body.sit_with = { type: long_read ? `Sunday long read · ${type}` : type, headline, desc, source, read_time, url };
  }
  return body;
}

// The raw error stays in brief:<date> (shown at /brief); the dashboard gets
// a plain sentence.
function failureEdition(date, newsCount) {
  const { day } = editionFor(date);
  const what = newsCount ? `The overnight pool was gathered (${newsCount} news items), but the step that writes the briefing failed.` : 'The overnight news pool was never built.';
  return { date, day, synthesis: esc(`No briefing this morning. ${what} Nothing here is from yesterday.`), headlines: [] };
}

// ── Delivery ─────────────────────────────────────────────────────────────

async function putDashboard(env, body) {
  if (!env.DASHBOARD_WRITE_KEY) throw new Error('missing DASHBOARD_WRITE_KEY');
  const req = new Request(DASHBOARD_URL, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-write-key': env.DASHBOARD_WRITE_KEY },
    body: JSON.stringify(body),
  });
  // Same-account workers.dev fetches fail (error 1042), so production goes
  // through the service binding.
  const r = await (env.DASHBOARD ? env.DASHBOARD.fetch(req) : fetch(req));
  if (!r.ok) throw new Error(`dashboard HTTP ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
}

// Only fresh stories are logged: recap threads and look-ahead items would
// otherwise count as repeat appearances in Monday's fatigue check.
function logEntry(brief) {
  const sw = brief.sit_with;
  return { date: brief.date, day: brief.day, edition: brief.logEdition, labels: brief.stories.map(s => s.log_label), sit_with: sw ? { title: sw.headline, source: sw.source, url: sw.url } : null };
}

async function deliver(env, brief) {
  const d = (brief.delivery ||= {});
  brief.delivery_attempts = (brief.delivery_attempts || 0) + 1;
  const step = async (k, fn) => {
    if (d[k] === 'ok' || d[k]?.startsWith('skipped')) return;
    try { await fn(); d[k] = 'ok'; } catch (e) { d[k] = `error: ${e.message}`; }
  };
  await step('dashboard', () => putDashboard(env, brief.dashboard));
  if (brief.status === 'failed') {
    d.storylog = d.notion = 'skipped: no edition';
    return;
  }
  await step('storylog', async () => {
    const entry = logEntry(brief);
    const cur = (await env.POOL.get('storylog', 'json'))?.entries || [];
    const keep = cur.filter(e => e.date !== entry.date && e.date >= shiftDate(brief.date, -LOG_DAYS));
    await env.POOL.put('storylog', JSON.stringify({ entries: [...keep, entry].sort((a, b) => a.date.localeCompare(b.date)) }));
  });
  await step('notion', () => appendStoryLog(env, logEntry(brief)));
  if (brief.sit_with?.long_read) await step('deep_dive_log', () => appendDeepDiveLog(env, brief.date, brief.sit_with.label || brief.sit_with.headline));
}

const needsDelivery = b => b.publish && b.delivery_attempts < MAX_DELIVERY_ATTEMPTS && Object.values(b.delivery || {}).some(v => v.startsWith('error'));

// ── The step ─────────────────────────────────────────────────────────────

// Each cron tick after the pool is built calls this once. States in
// brief:<date>: pending (batch not submitted yet) → submitted → done, or
// → direct (batch failed or late; full-price call) → done.
//
// opts.force: start today's edition over. opts.shadow: never publish.
// opts.direct: skip the batch (manual runs outside cron hours).
export async function judgeStep(env, prompt, { now = new Date(), force = false, shadow = false, scheduled = false, direct = false } = {}) {
  const kv = env.POOL;
  const date = chicagoDate(now);
  const key = `brief:${date}`;
  const nowMs = now.getTime();
  const primary = env.MODEL || DEFAULT_MODEL;
  const compareModel = env.COMPARE_MODEL && env.COMPARE_MODEL !== primary ? env.COMPARE_MODEL : null;
  const publish = env.PUBLISH === 'on' && !shadow;
  // Cutoff and deadline apply to cron runs only. A slow call is judged by
  // when it finished, so callers pass the elapsed time.
  const past = (at, ms = nowMs) => {
    if (!scheduled) return false;
    const d = new Date(ms);
    return d.getUTCHours() > at.h || (d.getUTCHours() === at.h && d.getUTCMinutes() >= at.m);
  };
  const save = b => kv.put(key, JSON.stringify(b), { expirationTtl: KV_TTL });

  let brief = force ? null : await kv.get(key, 'json');
  if (brief?.state === 'done') {
    if (!needsDelivery(brief)) return { date, state: 'done', status: brief.status };
    await deliver(env, brief);
    await save(brief);
    return { date, state: 'done', redelivered: brief.delivery };
  }
  if (brief?.running_since && nowMs - Date.parse(brief.running_since) < STALE_MS) return { date, state: brief.state, running: true };

  const [newsDoc, sitDoc] = await Promise.all([kv.get(`news:${date}`, 'json'), kv.get(`sitwith:${date}`, 'json')]);
  const base = { date, ...editionFor(date), publish, model: primary, compare_model: compareModel, errors: brief?.errors || [], submits: brief?.submits || 0, direct_attempts: brief?.direct_attempts || 0, batch_id: brief?.batch_id, submitted_at: brief?.submitted_at };
  const logError = (stage, e) => base.errors.push({ at: new Date().toISOString(), stage, error: e.message || String(e), ...(e.usage && { usage: e.usage }) });

  const fail = async reason => {
    brief = { ...base, state: 'done', status: 'failed', status_line: 'No briefing: judgment step failed.', reason, finished_at: new Date().toISOString(), dashboard: failureEdition(date, newsDoc?.count) };
    if (publish) await deliver(env, brief);
    await save(brief);
    return { date, state: 'done', status: 'failed', reason, delivery: brief.delivery };
  };

  if (!newsDoc) return past(DEADLINE_UTC) ? fail('the news pool was never built') : { date, state: 'waiting', waiting: 'pool' };

  // Context is gathered once, at submit, so the batch and any direct
  // fallback see the same story log and the same item IDs.
  base.ctx = brief?.ctx || (await gatherContext(env, date));
  const refMs = Date.parse(newsDoc.generated_at) || nowMs;
  const byId = indexPools(newsDoc, sitDoc, base.ctx.week);
  const input = buildInput({ date, byId, ctx: base.ctx, refMs, poolBuiltAt: newsDoc.generated_at });

  const finish = async (primaryResult, compareResult) => {
    const v = verify(primaryResult.out, { byId, date, refMs, ctx: base.ctx });
    brief = {
      ...base, state: 'done', ...v, usage: primaryResult.usage, log_source: base.ctx.log_source, notion_errors: base.ctx.notion_errors,
      pool: { news: newsDoc.count, sitwith: sitDoc?.count ?? 0, built_at: newsDoc.generated_at }, finished_at: new Date().toISOString(),
      dashboard: toDashboard(date, v),
    };
    if (compareResult) brief.compare = compareResult.error ? { error: compareResult.error, usage: compareResult.usage } : { ...verify(compareResult.out, { byId, date, refMs, ctx: base.ctx }), usage: compareResult.usage };
    if (publish) await deliver(env, brief);
    await save(brief);
    return { date, state: 'done', status: brief.status, via: brief.usage.via, items: brief.dashboard.headlines.length, problems: brief.problems.length, delivery: brief.delivery || 'shadow mode' };
  };

  // 1. Submit the batch.
  let compareCarry = null;
  if (!brief || brief.state === 'pending') {
    if (!direct && !past(CUTOFF_UTC) && base.submits < MAX_SUBMITS) {
      base.submits++;
      try {
        const batch_id = await submitBatch(env, compareModel ? [primary, compareModel] : [primary], prompt, input);
        await save({ ...base, state: 'submitted', batch_id, submitted_at: now.toISOString() });
        return { date, state: 'submitted', batch_id };
      } catch (e) {
        if (e.permanent) return fail(e.message);
        logError('submit', e);
        await save({ ...base, state: 'pending' });
        return { date, state: 'pending', error: e.message };
      }
    }
    brief = { ...base, state: 'direct' };
  }

  // 2. Collect it, or give up on it at the cutoff.
  if (brief.state === 'submitted') {
    let got = null;
    try {
      got = await collectBatch(env, brief.batch_id);
    } catch (e) {
      if (e.permanent) return fail(e.message);
      logError('collect', e);
    }
    if (got?.primary && !got.primary.error) return finish(got.primary, got.compare);
    if (got) {
      logError('batch', { message: got.primary?.error || 'no primary result', usage: got.primary?.usage });
      compareCarry = got.compare;
    } else if (!past(CUTOFF_UTC)) {
      if (base.errors.length > (brief.errors?.length || 0)) await save({ ...brief, ...base });
      return { date, state: 'submitted', waiting: 'batch' };
    } else {
      await client(env).messages.batches.cancel(brief.batch_id).catch(() => {});
      logError('batch', { message: `not back by ${CUTOFF_UTC.h}:${CUTOFF_UTC.m} UTC; cancelled` });
    }
    brief = { ...base, state: 'direct' };
  }

  // 3. Direct call at full price.
  if (base.direct_attempts >= MAX_DIRECT) return fail(`gave up after ${base.direct_attempts} direct attempts: ${base.errors.at(-1)?.error}`);
  base.direct_attempts++;
  await save({ ...base, state: 'direct', running_since: now.toISOString() });
  const t0 = Date.now();
  try {
    return await finish(await callDirect(env, primary, prompt, input), compareCarry);
  } catch (e) {
    if (e.permanent) return fail(e.message);
    logError('direct', e);
    if (base.direct_attempts >= MAX_DIRECT || past(DEADLINE_UTC, nowMs + Date.now() - t0)) return fail(e.message);
    await save({ ...base, state: 'direct' });
    return { date, state: 'direct', error: e.message };
  }
}
