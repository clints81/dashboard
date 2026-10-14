// Write one edition locally from the deployed Worker's pool, without
// publishing anything. Reads keys from .dev.vars (ANTHROPIC_API_KEY
// required; NOTION_TOKEN optional, for the story log and deep-dive log).
//
//   npm run judge-dry-run                         today's pool
//   npm run judge-dry-run -- 2026-10-04           an earlier pool (kept 45 days;
//                                                 2026-10-04 was a Sunday)
//   npm run judge-dry-run -- --both               also run the comparison model
//
// Calls are direct (full price, no batch wait): roughly $0.20–0.40 per
// model. Writes scratch/brief-<date>.json and scratch/brief-<date>.html.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { indexPools, buildInput, callDirect, verify, toDashboard, gatherContext, editionFor } from '../src/judge.js';
import { renderBrief } from '../src/brief-page.js';

const BASE = 'https://briefing-retrieval.clintsievers.workers.dev';
const PRIMARY = 'claude-opus-5-5', COMPARE = 'claude-sonnet-5-5';
const env = {};
if (existsSync('.dev.vars')) {
  for (const line of readFileSync('.dev.vars', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/);
    if (m && m[2]) env[m[1]] = m[2];
  }
}
if (!env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY is not set in .dev.vars'); process.exit(1); }

const args = process.argv.slice(2);
const both = args.includes('--both');
const dateArg = args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a));
const get = async path => { const r = await fetch(`${BASE}/${path}`); return r.ok ? r.json() : null; };

// Read-only stand-in for KV, backed by the deployed Worker's routes.
env.POOL = {
  async get(k) {
    const [prefix, d] = k.split(':');
    if (prefix === 'brief') return get(`brief/${d}?json`);
    if (prefix === 'cowork') return get(`cowork/${d}`);
    return null; // storylog: not exposed, so fatigue comes from Notion
  },
};

const [newsDoc, sitDoc] = await Promise.all([get(`news${dateArg ? `/${dateArg}` : ''}`), get(`sitwith${dateArg ? `/${dateArg}` : ''}`)]);
if (!newsDoc) { console.error('no pool for that date'); process.exit(1); }
const date = newsDoc.date;
// Without NOTION_TOKEN the story log is empty and that's noted below.
const ctx = await gatherContext(env, date);
for (const e of ctx.notion_errors) console.warn('Notion:', e);
const byId = indexPools(newsDoc, sitDoc, ctx.week);
const refMs = Date.parse(newsDoc.generated_at);
const input = buildInput({ date, byId, ctx, refMs, poolBuiltAt: newsDoc.generated_at });
const prompt = readFileSync(new URL('../src/briefing-prompt.md', import.meta.url), 'utf8');
console.log(`${date} · ${editionFor(date).edition} · ${newsDoc.count} news + ${sitDoc.count} sit-with · story log: ${ctx.history.length} days (${ctx.log_source}) · week items: ${ctx.week.length} · input ${input.length.toLocaleString()} chars`);

const settle = p => p.then(r => r, e => ({ error: e.message, usage: e.usage }));
const [p, c] = await Promise.all([settle(callDirect(env, PRIMARY, prompt, input)), both ? settle(callDirect(env, COMPARE, prompt, input)) : null]);
if (p.error) { console.error(`${PRIMARY} failed: ${p.error}`); process.exit(1); }
const v = verify(p.out, { byId, date, refMs, ctx });
const brief = {
  date, ...editionFor(date), state: 'done', publish: false, model: PRIMARY, compare_model: both ? COMPARE : null, ...v, usage: p.usage,
  log_source: ctx.log_source, notion_errors: ctx.notion_errors, pool: { news: newsDoc.count, sitwith: sitDoc.count, built_at: newsDoc.generated_at },
  finished_at: new Date().toISOString(), dashboard: toDashboard(date, v), raw: p.out,
};
if (c) brief.compare = c.error ? { error: c.error, usage: c.usage } : { ...verify(c.out, { byId, date, refMs, ctx }), usage: c.usage, raw: c.out };

mkdirSync('scratch', { recursive: true });
writeFileSync(`scratch/brief-${date}.json`, JSON.stringify(brief, null, 1));
writeFileSync(`scratch/brief-${date}.html`, renderBrief(brief, date));
if (c) writeFileSync(`scratch/brief-${date}-ab.html`, renderBrief(brief, date, { ab: true }));

const report = (name, v, u) => {
  console.log(`\n${name}: ${v.status} · ${u.input_tokens.toLocaleString()} in / ${u.output_tokens.toLocaleString()} out · $${u.cost_usd.toFixed(2)} direct ($${(u.cost_usd / 2).toFixed(2)} batched) · ${u.seconds}s`);
  for (const x of [...v.threads, ...v.ahead, ...v.stories]) console.log(`  ${x.category.padEnd(10)} ${x.floor ? '[floor] ' : ''}${x.when ? `[${x.when}] ` : ''}${x.title}  (${x.link_publisher})`);
  console.log(`  sit with: ${v.sit_with ? `${v.sit_with.headline} (${v.sit_with.source}, ${v.sit_with.read_time})` : 'none'}`);
  console.log(`  synthesis: ${v.synthesis}`);
  for (const pr of v.problems) console.log(`  ! ${pr}`);
};
report(PRIMARY, v, p.usage);
if (c) c.error ? console.log(`\n${COMPARE} failed: ${c.error}`) : report(COMPARE, brief.compare, c.usage);
console.log(`\nwrote scratch/brief-${date}.json and .html${c ? ' and -ab.html' : ''}`);
