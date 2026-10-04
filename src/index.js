// briefing-retrieval: pulls the morning candidate pools into KV.
//
//   cron  */5 10-11 * * *  → tick() (see run.js for why it's many ticks)
//
//   GET  /                 latest run summary + route list
//   GET  /news[/YYYY-MM-DD]     news candidate pool
//   GET  /sitwith[/YYYY-MM-DD]  something-to-sit-with pool (rolling 7 days)
//   GET  /status[/YYYY-MM-DD]   per-source results for a run (no items)
//   GET  /stats                 per-source ok/failed history, last 30 days
//   POST /run                   run now; needs X-Run-Key. ?all=1 does every
//                               pending source, ?force=1 restarts today's run.

import { tick, chicagoDate } from './run.js';

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
    ctx.waitUntil(tick(env, { now: new Date(controller.scheduledTime), scheduled: true }).then(r => {
      const { newsDoc, sitDoc, ...log } = r;
      console.log(JSON.stringify(log));
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
    if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);

    switch (route) {
      case '':
        return json({ latest: await env.POOL.get('latest', 'json'), routes: ['/news[/date]', '/sitwith[/date]', '/status[/date]', '/stats'] });
      case 'news':
      case 'sitwith':
        return getDoc(env, route, date);
      case 'status': {
        const run = await env.POOL.get(`run:${date || chicagoDate()}`, 'json');
        if (!run) return json({ error: 'no run for that date' }, 404);
        for (const u of Object.values(run.units)) delete u.items;
        return json(run);
      }
      case 'stats':
        return json((await env.POOL.get('stats', 'json')) || {});
      default:
        return json({ error: 'not found' }, 404);
    }
  },
};
