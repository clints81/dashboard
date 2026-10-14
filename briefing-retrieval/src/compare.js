// Comparison-week check: does the pool contain the stories the Cowork task
// actually picked? Cowork's briefing is read from the dashboard Worker
// (briefing.clintsievers.workers.dev, GET /) and snapshotted into KV as
// `cowork:<date>` so past days stay comparable after Cowork overwrites it.
//
// Matching is by headline words, not URL: Cowork often cites a different
// outlet for the same story. Each Cowork story gets its top 3 pool matches
// and a verdict. Scores are a rough guide; the page shows the candidates so
// a person makes the call. Thresholds were set against 2026-10-04, where
// true matches scored 0.16–0.32 and stories absent from the pool 0.09–0.14.

import { canonicalUrl } from './feed.js';

const COWORK_URL = 'https://briefing.clintsievers.workers.dev/';
const KV_TTL = 60 * 60 * 24 * 45;
const LIKELY = 0.2;
const CHECK = 0.15;

const STOP = new Set(('a an the and or but of to in on at for with by from as is are was were be been it its this that these those after before over under into than then new says say said how why what who will can could would may more most up out about amid vs not no his her their they he she we you our your has have had do does did just two one us').split(' '));
const norm = s => s.replace(/[’‘]/g, "'").replace(/'s\b/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const stem = w => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
const toks = s => norm(s).split(' ').filter(w => w && !STOP.has(w)).map(stem);

// Query words weighted: proper nouns 3, numbers 2, other words 1.
function weighted(text) {
  const w = new Map();
  const words = text.replace(/[’‘]/g, "'").split(/\s+/);
  words.forEach((raw, i) => {
    for (const t of toks(raw)) {
      const proper = /^[A-Z]/.test(raw) && i > 0 && !/[.:!?]$/.test(words[i - 1] || '');
      const wt = /\d/.test(t) ? 2 : proper ? 3 : 1;
      w.set(t, Math.max(w.get(t) || 0, wt));
    }
  });
  return w;
}

function score(q, itemToks) {
  let hit = 0, tot = 0;
  for (const [t, wt] of q) { tot += wt; if (itemToks.has(t)) hit += wt; }
  return tot ? hit / tot : 0;
}

const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

function matchOne(story, pool, poolName, outlets) {
  const url = canonicalUrl(story.url || '') || '';
  const q = weighted(`${story.title} ${story.summary || ''}`);
  const ranked = pool
    .map(i => ({ i, s: score(q, i._toks) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .map(({ i, s }) => ({ score: Math.round(s * 100) / 100, title: i.title, url: i.url, publisher: i.publisher, published_at: i.published_at, source: i.source }));
  const exact = pool.find(i => i.url === url);
  const best = ranked[0]?.score || 0;
  const verdict = exact ? 'same link' : best >= LIKELY ? 'likely' : best >= CHECK ? 'check' : 'not found';
  const h = host(story.url);
  const inPools = outlets[h] ? [...outlets[h]] : [];
  return {
    title: story.title, url: story.url, outlet: h, category: story.category || null,
    outlet_in_pool: inPools.length ? inPools.join(' + ') : 'not a source',
    pool: poolName, verdict, best, candidates: exact ? [{ score: 1, title: exact.title, url: exact.url, publisher: exact.publisher, published_at: exact.published_at, source: exact.source }, ...ranked.filter(r => r.url !== exact.url).slice(0, 2)] : ranked,
  };
}

export async function snapshotCowork(env, date) {
  // Workers on the same account can't fetch each other's workers.dev URLs
  // (Cloudflare error 1042), so production goes through the COWORK service
  // binding to the dashboard Worker. Same GET / the dashboard uses; read only.
  const req = new Request(`${COWORK_URL}?t=${Date.now()}`, { headers: { accept: 'application/json' } });
  const r = await (env.COWORK ? env.COWORK.fetch(req) : fetch(req));
  if (!r.ok) throw new Error(`cowork briefing HTTP ${r.status}`);
  const b = await r.json();
  if (!b.date) throw new Error('cowork briefing has no date');
  if (date && b.date !== date) return null; // Cowork hasn't written today's yet
  const snap = { ...b, snapshot_at: new Date().toISOString() };
  await env.POOL.put(`cowork:${b.date}`, JSON.stringify(snap), { expirationTtl: KV_TTL });
  return snap;
}

export async function buildCompare(env, date) {
  let cowork = await env.POOL.get(`cowork:${date}`, 'json');
  if (!cowork) cowork = await snapshotCowork(env, date).catch(() => null);
  const [news, sitwith, latest] = await Promise.all([
    env.POOL.get(`news:${date}`, 'json'),
    env.POOL.get(`sitwith:${date}`, 'json'),
    env.POOL.get('latest', 'json'),
  ]);
  const base = {
    date,
    pool_ready_at: news?.generated_at || null,
    failing: latest?.date === date ? latest.failing : null,
    news_count: news?.count ?? null,
    sitwith_count: sitwith?.count ?? null,
  };
  if (!cowork || !news) return { ...base, cowork: null, stories: [], waiting_on: !news ? 'pool' : 'cowork' };

  const prep = items => (items || []).map(i => ({ ...i, _toks: new Set(toks(`${i.title} ${i.summary || ''}`)) }));
  const newsItems = prep(news.items), sitItems = prep(sitwith?.items);
  const outlets = {};
  for (const i of [...newsItems, ...sitItems]) (outlets[host(i.url)] ||= new Set()).add(i.pool === 'news' ? 'news' : 'sit-with');

  const stories = (cowork.headlines || []).map(h => matchOne(h, newsItems, 'news', outlets));
  if (cowork.sit_with?.headline) {
    const s = cowork.sit_with;
    stories.push(matchOne({ title: s.headline, summary: s.desc, url: s.url, category: 'Sit with' }, sitItems, 'sit-with', outlets));
  }
  const tally = { 'same link': 0, likely: 0, check: 0, 'not found': 0 };
  for (const s of stories) tally[s.verdict]++;
  return { ...base, cowork_snapshot_at: cowork.snapshot_at || null, tally, stories, all: [...news.items, ...(sitwith?.items || [])].map(i => [i.title, i.publisher, i.url, i.published_at, i.pool, i.read_minutes ?? null, (i.summary || '').slice(0, 200)]) };
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ct = iso => iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';

export function renderCompare(c) {
  const v = { 'same link': 'ok', likely: 'ok', check: 'warn', 'not found': 'bad' };
  const head = `<p class="meta">Pool ready ${esc(ct(c.pool_ready_at))} · ${c.news_count ?? '—'} news · ${c.sitwith_count ?? '—'} sit-with · ${c.failing == null ? 'source status unknown' : c.failing.length ? `<span class="bad">failing: ${esc(c.failing.join(', '))}</span>` : 'no failing sources'}</p>`;
  let body;
  if (!c.stories.length) {
    body = `<p class="empty">${c.waiting_on === 'pool' ? 'No pool for this date.' : "No Cowork briefing for this date yet. Cowork writes it in the morning; this page picks it up on the next visit."}</p>`;
  } else {
    body = `<p class="meta">${Object.entries(c.tally).map(([k, n]) => `<span class="pill ${v[k]}">${n} ${esc(k)}</span>`).join(' ')}</p>` + c.stories.map(s => `
      <section class="story">
        <div class="top"><span class="pill ${v[s.verdict]}">${esc(s.verdict)}</span><span class="cat">${esc(s.category || '')}</span></div>
        <h2><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a></h2>
        <p class="outlet">${esc(s.outlet)} · outlet is ${s.outlet_in_pool === 'not a source' ? '<b>not a pool source</b>' : `in ${esc(s.outlet_in_pool)} pool`} · matched against ${esc(s.pool)} pool</p>
        <ol>${s.candidates.map(m => `<li><span class="score">${m.score.toFixed(2)}</span><a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.title)}</a> <span class="pub">${esc(m.publisher)} · ${esc(ct(m.published_at))}</span></li>`).join('')}</ol>
      </section>`).join('');
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pool vs Cowork</title>
<style>
:root{--bg:#faf8f5;--card:#fff;--ink:#1f1b16;--ink2:#5d554b;--line:#e6e0d7;--ok:#2f7a45;--okbg:#e3f1e7;--warn:#8a6100;--warnbg:#fbf0d4;--bad:#a2332a;--badbg:#f8e1de;--accent:#b4542f}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#171513;--card:#211e1b;--ink:#ece6dd;--ink2:#a59c90;--line:#35302a;--ok:#7fc794;--okbg:#1f3326;--warn:#e0b85a;--warnbg:#3a3020;--bad:#ef8c80;--badbg:#3d2420;--accent:#e08a63}}
:root[data-theme="dark"]{--bg:#171513;--card:#211e1b;--ink:#ece6dd;--ink2:#a59c90;--line:#35302a;--ok:#7fc794;--okbg:#1f3326;--warn:#e0b85a;--warnbg:#3a3020;--bad:#ef8c80;--badbg:#3d2420;--accent:#e08a63}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:860px;margin:0 auto;padding:24px 16px 64px}h1{font-size:22px;margin:0 0 4px}.meta{color:var(--ink2);font-size:13px;margin:6px 0}
.story{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:14px 0}
.story h2{font-size:16px;margin:6px 0 2px;line-height:1.35}.story h2 a{color:var(--ink);text-decoration:none}.story h2 a:hover{color:var(--accent)}
.top{display:flex;gap:10px;align-items:center}.cat{font-size:12px;color:var(--ink2)}.outlet{font-size:12px;color:var(--ink2);margin:0 0 8px}
.pill{display:inline-block;font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px}.pill.ok{background:var(--okbg);color:var(--ok)}.pill.warn{background:var(--warnbg);color:var(--warn)}.pill.bad{background:var(--badbg);color:var(--bad)}
.bad{color:var(--bad)}ol{margin:0;padding-left:0;list-style:none}li{padding:5px 0;border-top:1px solid var(--line);font-size:14px;overflow-wrap:anywhere}
li a,#results a{color:var(--ink)}.score{display:inline-block;width:42px;font:12px ui-monospace,Menlo,monospace;color:var(--ink2)}.pub{font-size:12px;color:var(--ink2)}
.empty{padding:24px;background:var(--card);border:1px dashed var(--line);border-radius:10px;color:var(--ink2)}
h3{margin:32px 0 6px;font-size:16px}input{width:100%;padding:10px 12px;font-size:15px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink)}
#results div{padding:6px 0;border-bottom:1px solid var(--line);font-size:14px;overflow-wrap:anywhere}nav a{color:var(--accent);font-size:13px;margin-right:12px}
</style></head><body><main>
<h1>Pool vs Cowork · ${esc(c.date)}</h1>
<nav><a href="/compare/${esc(prevDate(c.date))}">← previous day</a><a href="/compare">today</a></nav>
${head}${body}
<h3>Search the pool</h3>
<input id="q" placeholder="Words from a Cowork headline, e.g. White Sox" autocomplete="off">
<div id="results"></div>
</main><script>
const ALL=${JSON.stringify(c.all || []).replace(/</g, '\\u003c')};
const q=document.getElementById('q'),out=document.getElementById('results');
const e=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
q.addEventListener('input',()=>{const w=q.value.toLowerCase().split(/\\s+/).filter(Boolean);if(!w.length){out.innerHTML='';return}
const hits=ALL.filter(r=>{const t=(r[0]+' '+r[1]+' '+r[6]).toLowerCase();return w.every(x=>t.includes(x))}).slice(0,40);
out.innerHTML=hits.length?hits.map(r=>'<div><a href="'+e(r[2])+'" target="_blank" rel="noopener">'+e(r[0])+'</a> <span class="pub">'+e(r[1])+' · '+e(r[4])+(r[5]!=null?' · '+r[5]+' min':'')+'</span></div>').join(''):'<div class="pub">No pool items match.</div>'});
</script></body></html>`;
}

function prevDate(date) {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
