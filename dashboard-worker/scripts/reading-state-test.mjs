// Checks the /reading-state route through the Worker's own fetch handler,
// with KV and the cache replaced by stand-ins. Usage: npm run test:reading-state
//
// Keys here are made up ("read-test", "state-test"). A script that talks to
// the live Worker with real keys passes them through stdin, never as a
// command-line argument (see Read key in DASHBOARD-REFERENCE.md).

const READ = 'read-test', STATE = 'state-test';
const A = 'https://example.com/archived-pick';
const B = 'https://example.com/older-pick';
const LATEST = 'https://example.com/todays-pick';
const STALE = 'https://example.com/fell-out-of-the-archive';

// KV stand-in. Each call yields once, so two requests can interleave the
// way they would in a real Worker.
const store = new Map();
let kvBroken = false, puts = 0;
const tick = () => new Promise(r => setTimeout(r, 0));
const kv = {
  async get(k) { await tick(); if (kvBroken) throw new Error('kv down'); return store.has(k) ? store.get(k) : null; },
  async put(k, v) { await tick(); puts++; store.set(k, v); },
};
const cacheCalls = [];
globalThis.caches = { default: {
  match: async (...a) => { cacheCalls.push('match'); }, put: async () => { cacheCalls.push('put'); }, delete: async () => {},
} };

function reset() {
  store.clear();
  kvBroken = false;
  store.set('sitwith-archive', JSON.stringify([
    { date: '2026-10-31', day: 'Saturday', type: 'Essay', headline: 'A', desc: '', source: 'X', read_time: '~10 min', url: A },
    { date: '2026-10-30', day: 'Friday', type: 'Essay', headline: 'B', desc: '', source: 'X', read_time: '~10 min', url: B },
  ]));
  store.set('latest', JSON.stringify({ date: '2026-11-01', day: 'Sunday', sit_with: { headline: 'T', url: LATEST } }));
}

const worker = (await import('../src/index.js')).default;
const env = { BRIEFING: kv, READ_KEY: READ, STATE_KEY: STATE };
const call = async (method, { headers = {}, body, e = env } = {}) => {
  const res = await worker.fetch(new Request('https://worker.test/reading-state', { method, headers, body }), e, {});
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, headers: res.headers };
};
const mark = (url, done = true, key = STATE) =>
  call('POST', { headers: { 'X-State-Key': key, 'Content-Type': 'application/json' }, body: JSON.stringify({ url, done }) });
const state = () => JSON.parse(store.get('reading-state') ?? 'null');

let failed = 0, count = 0;
function check(name, ok, detail = '') {
  count++;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n    ${detail}`}`);
}

// ── Preflight and CORS ────────────────────────────────────────────────
reset();
{
  const r = await call('OPTIONS');
  const allow = r.headers.get('access-control-allow-headers') || '';
  check('OPTIONS allows X-Read-Key, X-State-Key, Content-Type', r.status === 200 && /X-Read-Key/.test(allow) && /X-State-Key/.test(allow) && /Content-Type/.test(allow), allow);
}

// ── GET needs the read key ────────────────────────────────────────────
for (const [name, headers, e, status, auth] of [
  ['GET without a key', {}, env, 401, 'missing'],
  ['GET with a wrong key', { 'X-Read-Key': 'nope' }, env, 401, 'rejected'],
  ['GET with the state key as the read key', { 'X-Read-Key': STATE }, env, 401, 'rejected'],
  ['GET with READ_KEY unset fails closed', { 'X-Read-Key': READ }, { ...env, READ_KEY: undefined }, 500, 'READ_KEY unset'],
]) {
  const r = await call('GET', { headers, e });
  check(`${name}: ${status} ${auth}`, r.status === status && r.json?.sources?.auth === auth && r.headers.get('access-control-allow-origin') === '*',
    `${r.status} ${JSON.stringify(r.json)}`);
}
{
  const r = await call('GET', { headers: { 'X-Read-Key': READ } });
  check('GET with nothing stored: empty, not an error', r.status === 200 && r.json.sources.kv === 'empty' && JSON.stringify(r.json.items) === '{}', JSON.stringify(r.json));
  check('GET is never cached', r.headers.get('cache-control') === 'no-store' && cacheCalls.length === 0, `${r.headers.get('cache-control')} ${cacheCalls}`);
}

// ── POST needs the state key, checked before the body is read ─────────
for (const [name, headers, e, status, auth] of [
  ['POST without a key', {}, env, 401, 'missing'],
  ['POST with only the read key', { 'X-Read-Key': READ }, env, 401, 'missing'],
  ['POST with the read key as the state key', { 'X-State-Key': READ }, env, 401, 'rejected'],
  ['POST with STATE_KEY unset fails closed', { 'X-State-Key': STATE }, { ...env, STATE_KEY: undefined }, 500, 'STATE_KEY unset'],
]) {
  const r = await call('POST', { headers, e, body: 'not even JSON' });
  check(`${name}: ${status} ${auth}`, r.status === status && r.json?.sources?.auth === auth && r.headers.get('access-control-allow-origin') === '*',
    `${r.status} ${JSON.stringify(r.json)}`);
}
check('refused POSTs wrote nothing', !store.has('reading-state'));

// ── POST accepts exactly {url, done} ──────────────────────────────────
for (const [name, body] of [
  ['not JSON', 'done'],
  ['an array', JSON.stringify([A, true])],
  ['an extra field', JSON.stringify({ url: A, done: true, at: 'x' })],
  ['done as a string', JSON.stringify({ url: A, done: 'true' })],
  ['no done', JSON.stringify({ url: A })],
  ['not a web URL', JSON.stringify({ url: 'javascript:alert(1)', done: true })],
  ['another key name', JSON.stringify({ key: 'latest', done: true })],
]) {
  const r = await call('POST', { headers: { 'X-State-Key': STATE }, body });
  check(`refuses ${name} (400)`, r.status === 400, `${r.status} ${JSON.stringify(r.json)}`);
}
{
  const r = await call('POST', { headers: { 'X-State-Key': STATE }, body: JSON.stringify({ url: A + '?' + 'x'.repeat(5000), done: true }) });
  check('refuses a body over 4 KB (413)', r.status === 413, `${r.status}`);
  const u = await mark('https://example.com/not-a-pick');
  check('refuses a URL that is not a sit-with pick', u.status === 400 && /not a sit-with pick/.test(u.json.error), JSON.stringify(u.json));
}
check('refused bodies wrote nothing', !store.has('reading-state'));
check('nothing but reading-state was ever touched', [...store.keys()].sort().join() === 'latest,sitwith-archive');

// ── Marking and unmarking ─────────────────────────────────────────────
{
  const r = await mark(A);
  const s = state();
  check('marks an archived pick done', r.status === 200 && r.json.written === true && s[A]?.status === 'done' && !isNaN(Date.parse(s[A].at)), JSON.stringify([r.json, s]));
  const at = s[A].at;
  const before = puts;
  const again = await mark(A);
  check('marking twice writes nothing to KV and keeps the first time', again.json.written === false && puts === before && state()[A].at === at, JSON.stringify(again.json));
  const t = await mark(LATEST);
  check("marks today's pick (not archived yet)", t.status === 200 && state()[LATEST]?.status === 'done', JSON.stringify(t.json));
  const g = await call('GET', { headers: { 'X-Read-Key': READ } });
  check('GET shows both marks', g.json.sources.kv === 'ok' && Object.keys(g.json.items).sort().join() === [A, LATEST].sort().join(), JSON.stringify(g.json));
  const un = await mark(A, false);
  check('unmarks', un.json.written === true && !(A in state()) && LATEST in state(), JSON.stringify(state()));
  const before2 = puts;
  const un2 = await mark(A, false);
  check('unmarking twice writes nothing to KV', un2.json.written === false && puts === before2, JSON.stringify(un2.json));
}

// ── The cap: marks for picks that left the archive are dropped ────────
reset();
store.set('reading-state', JSON.stringify({ [STALE]: { status: 'done', at: '2026-08-01T12:00:00.000Z' }, [B]: { status: 'done', at: '2026-10-30T12:00:00.000Z' } }));
{
  await mark(A);
  const s = state();
  check('drops marks whose pick left the archive, keeps the rest', !(STALE in s) && B in s && A in s, JSON.stringify(s));
}

// ── Two devices at once ───────────────────────────────────────────────
reset();
{
  const [r1, r2] = await Promise.all([mark(A), mark(B)]);
  const s = state();
  check('two marks sent together both survive', r1.status === 200 && r2.status === 200 && A in s && B in s, JSON.stringify(s));
  const [r3] = await Promise.all([mark('https://example.com/not-a-pick'), mark(LATEST)]);
  check('a refused POST does not jam the next one', r3.status === 400 && LATEST in state(), JSON.stringify(state()));
}

// ── Failures are reported, and stored marks are never overwritten ─────
reset();
store.set('sitwith-archive', 'not json');
{
  const r = await mark(A);
  check('archive unreadable: 503, nothing written', r.status === 503 && !store.has('reading-state'), `${r.status} ${JSON.stringify(r.json)}`);
}
reset();
store.set('reading-state', '[oops');
{
  const r = await mark(A);
  check('reading-state unreadable: 500, left as it was', r.status === 500 && store.get('reading-state') === '[oops', `${r.status} ${store.get('reading-state')}`);
  const g = await call('GET', { headers: { 'X-Read-Key': READ } });
  check('GET reports it as unreadable', g.status === 200 && g.json.sources.kv === 'unreadable', JSON.stringify(g.json));
}
reset();
kvBroken = true;
{
  const g = await call('GET', { headers: { 'X-Read-Key': READ } });
  check('GET reports a KV error', g.json.sources.kv === 'error: kv down', JSON.stringify(g.json));
  const r = await mark(A);
  check('POST with KV down: 503', r.status === 503, `${r.status} ${JSON.stringify(r.json)}`);
}
{
  const r = await call('PUT', { headers: { 'X-Read-Key': READ, 'X-State-Key': STATE }, body: '{}' });
  check('other methods: 405', r.status === 405, `${r.status}`);
}

console.log(failed ? `\n${failed} of ${count} checks failed` : `\nall ${count} checks pass`);
process.exit(failed ? 1 : 0);
