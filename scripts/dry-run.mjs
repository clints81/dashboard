// Run every source once on this machine, without KV, and print a per-source
// table. Reads keys from .dev.vars if present. Usage: npm run dry-run
// Pass --json to dump the assembled pools to scratch/dry-run.json.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tick } from '../src/run.js';

const env = {};
if (existsSync('.dev.vars')) {
  for (const line of readFileSync('.dev.vars', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/);
    if (m) env[m[1]] = m[2];
  }
}

const r = await tick(env, { all: true, force: true });
const rows = Object.entries({ ...r.newsDoc.sources, ...r.sitDoc.sources }).map(([id, s]) => ({
  source: id, status: s.status, fetched: s.fetched ?? '', valid: s.valid ?? '', undated: s.undated ?? '',
  in_window: s.in_window, kept: s.kept, via: s.via ?? '', error: s.error ?? '',
}));
console.table(rows);
console.log(`news: ${r.news} items · sitwith: ${r.sitwith} items · not ok: ${r.failing.join(', ') || 'none'}`);
if (process.argv.includes('--json')) {
  mkdirSync('scratch', { recursive: true });
  writeFileSync('scratch/dry-run.json', JSON.stringify({ news: r.newsDoc, sitwith: r.sitDoc }, null, 1));
  console.log('wrote scratch/dry-run.json');
}
