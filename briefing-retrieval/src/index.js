// briefing-retrieval: pulls the morning candidate pools into KV.
//
//   cron  */5 6-9 * * *  → tick() builds the pools (see run.js for why it's
//                          many ticks); once they're built, judgeStep()
//                          submits and collects the briefing (see judge.js)
//   cron  0 12 * * *     → save the Cowork briefing as cowork:<date> (7am CDT / 6am CST)
//
//   GET  /                 latest run summary + route list
//   GET  /news[/YYYY-MM-DD]     news candidate pool
//   GET  /sitwith[/YYYY-MM-DD]  something-to-sit-with pool (rolling 7 days)
//   GET  /status[/YYYY-MM-DD]   per-source results for a run (no items)
//   GET  /stats                 per-source ok/failed history, last 30 days
//   GET  /compare[/YYYY-MM-DD]  Cowork's stories matched against the pool (HTML;
//                               ?json for the dashboard card)
//   GET  /brief[/YYYY-MM-DD]    the edition: full summaries + verification (HTML;
//                               ?json for the stored record)
//   POST /run                   run now; needs X-Run-Key. ?all=1 does every
//                               pending source, ?force=1 restarts today's run.
//   GET  /brief/YYYY-MM-DD?ab   the primary and comparison models side by side
//   GET  /cowork[/YYYY-MM-DD]   Cowork's briefing as snapshotted (for the dry run)
//   POST /judge                 advance today's briefing now; needs X-Run-Key.
//                               Submits a batch, or collects one already
//                               submitted. ?direct=1 calls directly (full price),
//                               ?force=1 starts over, ?shadow=1 never publishes.

import { tick, chicagoDate } from './run.js';
import { buildCompare, renderCompare, snapshotCowork } from './compare.js';
import { judgeStep } from './judge.js';
import { renderBrief } from './brief-page.js';
import PROMPT from './briefing-prompt.md';

const SNAPSHOT_CRON = '0 12 * * *';

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'Content-Type, X-Run-Key', 'access-control-allow-methods': 'GET, POST, OPTIONS' };

const json = (body, status = 200) =>
  new Response(JSON.stringify(body, null, 1), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS } });

async function getDoc(env, prefix, date) {
  if (!date) date = (await env.POOL.get('latest', 'json'))?.date || chicagoDate();
  const doc = await env.POOL.get(`${prefix}:${date}`, 'json');
  return doc ? json(doc) : json({ error: `no ${prefix} for ${date}` }, 404);
}

export default {
  async scheduled(controller, env, ctx) {
    if (controller.cron === SNAPSHOT_CRON) {
      ctx.waitUntil(snapshotCowork(env, chicagoDate()).then(b => console.log(b ? `cowork snapshot ${b.date}` : 'cowork briefing not yet written for today')));
      return;
    }
    const now = new Date(controller.scheduledTime);
    ctx.waitUntil(tick(env, { now, scheduled: true }).then(async r => {
      const { newsDoc, sitDoc, ...log } = r;
      console.log(JSON.stringify(log));
      // Judge only on ticks after the one that built the pools (that tick
      // returns pool counts; later ones return just finalized: true), so it
      // never shares the free plan's CPU and fetch limits with retrieval.
      if (r.finalized && r.news === undefined) console.log(JSON.stringify({ judge: await judgeStep(env, PROMPT, { now, scheduled: true }) }));
    }));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const [, route, date] = url.pathname.split('/');
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: 'date must be YYYY-MM-DD' }, 400);

    if (request.method === 'POST' && route === 'run') {
      if (!env.RUN_KEY || request.headers.get('X-Run-Key') !== env.RUN_KEY) return json({ error: 'unauthorized' }, 401);
      const { newsDoc, sitDoc, ...r } = await tick(env, { all: url.searchParams.has('all'), force: url.searchParams.has('force') });
      return json(r);
    }
    if (request.method === 'POST' && route === 'judge') {
      if (!env.RUN_KEY || request.headers.get('X-Run-Key') !== env.RUN_KEY) return json({ error: 'unauthorized' }, 401);
      const q = k => url.searchParams.has(k);
      return json(await judgeStep(env, PROMPT, { force: q('force'), shadow: q('shadow'), direct: q('direct') }));
    }
    if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);

    switch (route) {
      case '':
        return json({ latest: await env.POOL.get('latest', 'json'), routes: ['/brief[/date]', '/compare[/date]', '/news[/date]', '/sitwith[/date]', '/status[/date]', '/stats'] });
      case 'news':
      case 'sitwith':
        return getDoc(env, route, date);
      case 'status': {
        const run = await env.POOL.get(`run:${date || chicagoDate()}`, 'json');
        if (!run) return json({ error: 'no run for that date' }, 404);
        for (const u of Object.values(run.units)) delete u.items;
        return json(run);
      }
      case 'compare': {
        const c = await buildCompare(env, date || chicagoDate());
        if (url.searchParams.has('json')) {
          const { all, ...rest } = c;
          return json(rest);
        }
        return new Response(renderCompare(c), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
      }
      case 'brief': {
        const d = date || chicagoDate();
        const b = await env.POOL.get(`brief:${d}`, 'json');
        if (url.searchParams.has('json')) return b ? json(b) : json({ error: `no brief for ${d}` }, 404);
        return new Response(renderBrief(b, d, { ab: url.searchParams.has('ab') }), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
      }
      case 'cowork':
        return getDoc(env, 'cowork', date);
      case 'stats':
        return json((await env.POOL.get('stats', 'json')) || {});
      default:
        return json({ error: 'not found' }, 404);
    }
  },
};
