// Two Notion log pages, both written by the old Cowork tasks with
// `## YYYY-MM-DD | Day | edition` headings followed by bullets, which Notion
// stores as heading_2 + bulleted_list_item blocks.
//
//   STORY_LOG_PAGE  📰 News Briefing — Story Log. Read only to fill fatigue
//                   history KV doesn't have yet; each published edition is
//                   appended as the readable copy.
//   DEEP_DIVE_PAGE  📚 Deep Dive Log — Sunday Long-Form. Read every Sunday
//                   for the 28-day no-repeat rule; each Sunday long read is
//                   appended.
//
// The integration behind NOTION_TOKEN must be connected to both pages
// (page ⋯ menu → Connections), or calls return 404.

export const STORY_LOG_PAGE = '33af8d21-7e64-8184-a001-db0a563a70b9';
export const DEEP_DIVE_PAGE = '3a2f8d21-7e64-81fe-896f-db669b963068';
const API = 'https://api.notion.com/v1';
const VERSION = '2022-06-28';
// A year of entries is ~4,700 blocks; reading stops well before that
// because the Worker only reads Notion during the first week after cutover.
const MAX_PAGES = 8;

async function notion(env, path, init = {}) {
  if (!env.NOTION_TOKEN) throw new Error('missing NOTION_TOKEN');
  const r = await fetch(API + path, {
    ...init,
    headers: { authorization: `Bearer ${env.NOTION_TOKEN}`, 'notion-version': VERSION, 'content-type': 'application/json' },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    const e = new Error(`Notion ${r.status}: ${body.slice(0, 200)}`);
    e.http = r.status;
    throw e;
  }
  return r.json();
}

const text = b => (b[b.type]?.rich_text || []).map(t => t.plain_text).join('').trim();
const HEADING = /^(\d{4}-\d{2}-\d{2})\s*\|\s*(\w+)\s*\|\s*([\w-]+)/;
const SIT = /^Sit with:\s*/i;

// Returns [{ date, day, edition, labels: [...], sit_with: { title } | null }]
// for entries on or after sinceDate whose edition matches.
export async function readLog(env, page, sinceDate, editions) {
  const entries = [];
  let cur = null, cursor;
  for (let n = 0; n < MAX_PAGES; n++) {
    const q = `?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`;
    const res = await notion(env, `/blocks/${page}/children${q}`);
    for (const b of res.results) {
      if (b.type === 'heading_2') {
        const m = text(b).match(HEADING);
        cur = m && editions.test(m[3]) && m[1] >= sinceDate ? { date: m[1], day: m[2], edition: m[3], labels: [], sit_with: null } : null;
        if (cur) entries.push(cur);
      } else if (cur && b.type === 'bulleted_list_item') {
        const t = text(b);
        if (SIT.test(t)) cur.sit_with = { title: t.replace(SIT, '') };
        else if (t) cur.labels.push(t);
      }
    }
    if (!res.has_more) break;
    cursor = res.next_cursor;
  }
  return entries;
}

export const readStoryLog = (env, sinceDate) => readLog(env, STORY_LOG_PAGE, sinceDate, /^week(day|end)$/);
export const readDeepDiveLog = (env, sinceDate) => readLog(env, DEEP_DIVE_PAGE, sinceDate, /^deep-dive$/);

const rich = content => [{ type: 'text', text: { content: content.slice(0, 2000) } }];
const bullet = t => ({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: rich(t) } });
const heading = t => ({ object: 'block', type: 'heading_2', heading_2: { rich_text: rich(t) } });

export async function appendStoryLog(env, entry) {
  const bullets = entry.labels.map(bullet);
  if (entry.sit_with) bullets.push(bullet(`Sit with: ${entry.sit_with.title} (${entry.sit_with.source})`));
  const children = [heading(`${entry.date} | ${entry.day} | ${entry.edition}`), ...bullets];
  await notion(env, `/blocks/${STORY_LOG_PAGE}/children`, { method: 'PATCH', body: JSON.stringify({ children }) });
}

// Same format the Cowork deep-dive task used: one 3–7 word label.
export async function appendDeepDiveLog(env, date, label) {
  const children = [heading(`${date} | Sunday | deep-dive`), bullet(label)];
  await notion(env, `/blocks/${DEEP_DIVE_PAGE}/children`, { method: 'PATCH', body: JSON.stringify({ children }) });
}
