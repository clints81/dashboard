// /brief: the edition with its sources and verification record.
// /brief/<date>?ab: the primary and comparison models side by side.

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ct = iso => iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
const shift = (date, days) => { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const MODEL_NAMES = { 'claude-opus-5-5': 'Opus 5.5', 'claude-sonnet-5-5': 'Sonnet 5.5' };
const modelName = m => MODEL_NAMES[m] || m || '—';
const usageLine = u => u ? `${esc(modelName(u.model))} · ${esc(u.via)} · ${u.input_tokens.toLocaleString()} in / ${u.output_tokens.toLocaleString()} out · $${u.cost_usd.toFixed(2)}` : '—';
const EDITION_NAMES = { weekday: 'Weekday', saturday: 'Saturday · the week that was', sunday: 'Sunday · the week ahead' };

function entry(x, { kind, full }) {
  const tags = [
    `<span class="cat">${esc(x.category)}</span>`,
    x.floor ? '<span class="pill warn">floor</span>' : '',
    kind === 'ahead' ? `<span class="pill">${esc(x.when)}</span>` : '',
    kind === 'story' && full ? `<span class="cont">${x.continues_label ? `continues: ${esc(x.continues_label)}` : 'new this week'}${x.whats_new ? ` · new: ${esc(x.whats_new)}` : ''}</span>` : '',
  ].join('');
  const sources = full ? `<ol>${x.items.map(i => `<li><span class="id">${esc(i.id)}</span><a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a> <span class="pub">${esc(i.publisher)} · ${i.shown_on ? `shown ${esc(i.shown_on)}` : esc(ct(i.published_at))}${i.url === x.url ? ' · <b>linked</b>' : ''}</span></li>`).join('')}</ol>` : '';
  return `<section class="story"><div class="top">${tags}</div>
  <h2><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a></h2>
  <p>${esc(x.summary)}</p>
  ${x.coverage_note ? `<p class="note"><b>Coverage:</b> ${esc(x.coverage_note)}</p>` : ''}
  ${full && kind === 'story' ? `<p class="note">Log: ${esc(x.log_label)}</p>` : ''}${sources}</section>`;
}

// The edition's readable body. full: sources and audit fields too.
function edition(v, full) {
  const sit = v.sit_with;
  return `${v.status_line ? `<p class="banner warn">${esc(v.status_line)}</p>` : ''}
<p class="synth">${esc(v.synthesis)}</p>
${v.threads?.length ? `<h3>The week that was</h3>${v.threads.map(t => entry(t, { kind: 'thread', full })).join('')}` : ''}
${v.ahead?.length ? `<h3>The week ahead</h3>${v.ahead.map(a => entry(a, { kind: 'ahead', full })).join('')}` : ''}
${v.stories?.length ? `${v.edition === 'weekday' ? '' : '<h3>Since yesterday</h3>'}${v.stories.map(s => entry(s, { kind: 'story', full })).join('')}` : ''}
<h3>${sit?.long_read ? 'Sunday long read' : 'Something to sit with'}</h3>
${sit ? `<section class="story"><div class="top"><span class="cat">${esc(sit.type)}</span></div><h2><a href="${esc(sit.url)}" target="_blank" rel="noopener">${esc(sit.headline)}</a></h2><p>${esc(sit.desc)}</p><p class="pub">${esc(sit.source)} · ${esc(sit.read_time)}</p></section>` : '<p class="empty">No pick passed verification.</p>'}
<table>
<tr><th>Floor</th><td>${Object.entries(v.floor).map(([k, s]) => `${esc(k)}: <span class="${s === 'MISSED' ? 'bad' : ''}">${esc(s)}</span>`).join('<br>')}</td></tr>
<tr><th>Dropped / fixed</th><td>${v.problems.length ? v.problems.map(esc).join('<br>') : 'nothing'}</td></tr>
<tr><th>Model notes</th><td>${esc(v.notes || '—')}</td></tr>
<tr><th>Model</th><td>${usageLine(v.usage)}</td></tr>
</table>`;
}

export function renderBrief(b, date, { ab = false } = {}) {
  const nav = `<nav><a href="/brief/${shift(date, -1)}${ab ? '?ab' : ''}">← previous day</a><a href="/brief${ab ? `/${date}?ab` : ''}">today</a>${b?.compare ? `<a href="/brief/${date}${ab ? '' : '?ab'}">${ab ? 'single view' : `compare with ${esc(modelName(b.compare_model))}`}</a>` : ''}<a href="/brief/${date}?json">JSON</a></nav>`;
  let body;
  if (!b) body = `<p class="empty">No edition for ${esc(date)}. It's submitted once the pool is built (around 1:45am Central) and usually back within the hour.</p>`;
  else if (b.state !== 'done') body = `<p class="empty">In progress: ${esc(b.state)}${b.batch_id ? ` (batch submitted ${esc(ct(b.submitted_at))})` : ''}.${b.errors?.length ? ` Last error: ${esc(b.errors.at(-1).error)}` : ''}</p>`;
  else if (b.status === 'failed') body = `<p class="banner bad">${esc(b.status_line)} ${esc(b.reason)}</p>${errorsTable(b)}`;
  else if (ab && b.compare) {
    const col = (v, model) => `<div class="col"><h2 class="colhead">${esc(modelName(model))}</h2>${v.error ? `<p class="banner bad">${esc(v.error)}</p>` : edition(v, false)}</div>`;
    body = `<p class="meta">Same pool, same prompt, same story log. Dashboard and logs use ${esc(modelName(b.model))}.</p><div class="ab">${col(b, b.model)}${col(b.compare, b.compare_model)}</div>`;
  } else {
    const pill = { ok: 'ok', partial: 'warn' }[b.status];
    body = `<p class="meta"><span class="pill ${pill}">${esc(b.status)}</span> ${esc(EDITION_NAMES[b.edition])} · ${b.dashboard.headlines.length} items · ${b.publish ? 'published' : '<b>shadow mode</b>: not on the dashboard'} · ${esc(ct(b.finished_at))}</p>
${edition(b, true)}
<table>
<tr><th>Story log</th><td>${esc(b.log_source)}${(b.notion_errors || []).map(e => `<br><span class="bad">Notion: ${esc(e)}</span>`).join('')}</td></tr>
<tr><th>Pool</th><td>${b.pool.news} news · ${b.pool.sitwith} sit-with · built ${esc(ct(b.pool.built_at))}</td></tr>
${b.compare ? `<tr><th>Comparison</th><td>${b.compare.error ? `<span class="bad">${esc(b.compare.error)}</span>` : usageLine(b.compare.usage)}</td></tr>` : ''}
<tr><th>Delivery</th><td>${b.delivery ? Object.entries(b.delivery).map(([k, v]) => `${esc(k)}: <span class="${v.startsWith('error') ? 'bad' : ''}">${esc(v)}</span>`).join('<br>') : 'shadow mode: nothing sent'}</td></tr>
</table>${errorsTable(b)}`;
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Morning Briefing</title>
<style>
:root{--bg:#faf8f5;--card:#fff;--ink:#1f1b16;--ink2:#5d554b;--line:#e6e0d7;--ok:#2f7a45;--okbg:#e3f1e7;--warn:#8a6100;--warnbg:#fbf0d4;--bad:#a2332a;--badbg:#f8e1de;--accent:#b4542f;--chip:#efe9e1}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#171513;--card:#211e1b;--ink:#ece6dd;--ink2:#a59c90;--line:#35302a;--ok:#7fc794;--okbg:#1f3326;--warn:#e0b85a;--warnbg:#3a3020;--bad:#ef8c80;--badbg:#3d2420;--accent:#e08a63;--chip:#2c2824}}
:root[data-theme="dark"]{--bg:#171513;--card:#211e1b;--ink:#ece6dd;--ink2:#a59c90;--line:#35302a;--ok:#7fc794;--okbg:#1f3326;--warn:#e0b85a;--warnbg:#3a3020;--bad:#ef8c80;--badbg:#3d2420;--accent:#e08a63;--chip:#2c2824}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:820px;margin:0 auto;padding:24px 16px 64px}main.wide{max-width:1240px}h1{font-size:22px;margin:0 0 4px}.meta{color:var(--ink2);font-size:13px;margin:6px 0}
.synth{font-size:17px;line-height:1.6;margin:16px 0 8px}.banner{padding:10px 14px;border-radius:8px;font-weight:600}.banner.warn{background:var(--warnbg);color:var(--warn)}.banner.bad{background:var(--badbg);color:var(--bad)}
.story{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 16px;margin:12px 0}.story p{margin:4px 0}
.story h2{font-size:16px;margin:6px 0 2px;line-height:1.35}.story h2 a{color:var(--ink);text-decoration:none}.story h2 a:hover{color:var(--accent)}
.top{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.cat{font-size:12px;font-weight:600;color:var(--accent);text-transform:uppercase;letter-spacing:.04em}.cont{font-size:12px;color:var(--ink2)}
.note{font-size:13px;color:var(--ink2)}
.pill{display:inline-block;font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;background:var(--chip);color:var(--ink2)}.pill.ok{background:var(--okbg);color:var(--ok)}.pill.warn{background:var(--warnbg);color:var(--warn)}
.bad{color:var(--bad)}ol{margin:8px 0 0;padding-left:0;list-style:none}li{padding:5px 0;border-top:1px solid var(--line);font-size:13px;overflow-wrap:anywhere}li a{color:var(--ink)}
.id{display:inline-block;width:42px;font:12px ui-monospace,Menlo,monospace;color:var(--ink2)}.pub{font-size:12px;color:var(--ink2)}
.empty{padding:20px;background:var(--card);border:1px dashed var(--line);border-radius:10px;color:var(--ink2)}
h3{margin:28px 0 4px;font-size:16px}table{width:100%;border-collapse:collapse;font-size:13px;margin-top:20px}th{text-align:left;vertical-align:top;color:var(--ink2);font-weight:600;padding:6px 12px 6px 0;width:130px}td{padding:6px 0;border-top:1px solid var(--line);overflow-wrap:anywhere}
nav a{color:var(--accent);font-size:13px;margin-right:12px}
.ab{display:grid;grid-template-columns:1fr 1fr;gap:24px}.colhead{font-size:18px;margin:12px 0 0;padding-bottom:6px;border-bottom:2px solid var(--accent)}
@media (max-width:760px){.ab{grid-template-columns:1fr}}
</style></head><body><main${ab ? ' class="wide"' : ''}>
<h1>Morning Briefing · ${esc(date)}</h1>
${nav}${body}
</main></body></html>`;
}

function errorsTable(b) {
  if (!b.errors?.length) return '';
  return `<h3>Errors along the way</h3><table>${b.errors.map(e => `<tr><th>${esc(e.stage)}</th><td>${esc(ct(e.at))} · ${esc(e.error)}</td></tr>`).join('')}</table>`;
}
