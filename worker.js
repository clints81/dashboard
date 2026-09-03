// ─────────────────────────────────────────────────────────────────────────
//  /sports route for briefing.clintsievers.workers.dev
//
//  Why this runs in the Worker and not the browser: the dashboard is served
//  from clints81.github.io, and nytimes.com does not send the CORS headers
//  that would let a page on another origin read its RSS. Server-side fetches
//  aren't subject to that rule. The Worker also caches, so five feeds get
//  pulled once every 20 minutes instead of once per dashboard load.
//
//  Matching strategy — this is the important part:
//    The Athletic's article slugs name what a story is ABOUT.
//    Titles and descriptions merely mention things. A story about Arsenal
//    can name Tottenham in its description; its slug will not say tottenham.
//    So: slug match = confident. Title match = probable. Description = ignored.
// ─────────────────────────────────────────────────────────────────────────

const ATHLETIC = 'https://www.nytimes.com/athletic/rss';

const TEAMS = [
  { key: 'cubs',      label: 'Cubs',      league: 'MLB', feed: `${ATHLETIC}/mlb`,
    slugs: ['cubs'], cap: 3 },
  { key: 'lions',     label: 'Lions',     league: 'NFL', feed: `${ATHLETIC}/nfl`,
    slugs: ['lions'],
    // Bare "lions" is safe inside an NFL-only feed, but add here if the rugby
    // tour or a college cross-post ever slips through.
    exclude: ['nittany', 'british-irish', 'columbia'], cap: 3 },
  { key: 'redwings',  label: 'Red Wings', league: 'NHL', feed: `${ATHLETIC}/nhl`,
    slugs: ['red-wings'], cap: 3 },
  { key: 'tottenham', label: 'Tottenham', league: 'EPL', feed: `${ATHLETIC}/football`,
    slugs: ['tottenham'], cap: 3 },
];

// The Athletic barely covers Northwestern, so this one comes from Google News.
// Google News links are redirect URLs with no usable slug, so it matches on
// title only — and its titles carry a " - Publisher" suffix we strip.
const NORTHWESTERN = {
  key: 'northwestern', label: 'Northwestern', league: 'NU',
  feed: 'https://news.google.com/rss/search?q=%22Northwestern+Wildcats%22&hl=en-US&gl=US&ceid=US:en',
  titles: ['northwestern'],
  googleNews: true,
  // Lower than the others on purpose. The Athletic feeds are self-limiting —
  // there are only so many Cubs stories a day. A search query is not: Google
  // returns 100 hits for "Northwestern Wildcats" every single time, most of
  // them athletic-department press releases. Without a cap this one source
  // fills the whole card.
  cap: 2,
};

// League-level feeds, used to fill leftover slots when the teams are quiet.
const LEAGUE_FEEDS = [
  { league: 'MLB',   feed: `${ATHLETIC}/mlb` },
  { league: 'NFL',   feed: `${ATHLETIC}/nfl` },
  { league: 'EPL',   feed: `${ATHLETIC}/football` },
  { league: 'NCAAF', feed: `${ATHLETIC}/college-football` },
];

const CACHE_SECONDS = 20 * 60;
const MAX_AGE_HOURS = 36;

// ── RSS parsing ───────────────────────────────────────────────────────────
// Workers have no DOM, so no DOMParser. RSS is regular enough for this.

function decodeEntities(str = '') {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decodeEntities(m[1]) : '';
}

function parseFeed(xml) {
  const items = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  for (const b of blocks) {
    const link = tag(b, 'link');
    if (!link) continue;
    items.push({
      title: tag(b, 'title').replace(/\s+/g, ' '),
      desc:  tag(b, 'description').replace(/\s+/g, ' '),
      url:   link,
      date:  tag(b, 'pubDate'),
    });
  }
  return items;
}

// ── Filtering ─────────────────────────────────────────────────────────────

function slugOf(url) {
  try { return new URL(url).pathname.toLowerCase(); } catch { return ''; }
}

// Live blogs are rolling posts that never resolve. They also mention every
// club in the league, which makes them false-positive magnets.
function isLiveBlog(url) {
  return slugOf(url).includes('/live-blogs/');
}

function isFresh(dateStr, hours = MAX_AGE_HOURS) {
  const t = Date.parse(dateStr);
  if (Number.isNaN(t)) return true; // no usable date — don't drop it on that basis
  return (Date.now() - t) < hours * 3600 * 1000;
}

function matchTeam(item, team) {
  const slug  = slugOf(item.url);
  const title = item.title.toLowerCase();

  if (team.exclude?.some(x => slug.includes(x) || title.includes(x))) return null;

  if (team.slugs?.some(s => slug.includes(s))) return 'slug';

  // Title matching only where there's no usable slug (Google News redirects).
  // On Athletic URLs it would readmit the noise the slug rule exists to remove:
  // "Arsenal's window graded & what it means for Spurs" is an Arsenal story.
  if (team.googleNews && team.titles?.some(t => title.includes(t))) return 'title';
  return null;
}

// Returns { items, status } so a blocked fetch, a timeout, and a genuinely
// empty feed stop looking identical from the outside.
async function getFeed(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'clint-morning-dashboard/1.0 (personal use)',
        'Accept': 'application/rss+xml, application/xml, text/xml',
      },
      cf: { cacheTtl: 300, cacheEverything: true },
    });
    if (!res.ok) return { items: [], status: `HTTP ${res.status}` };
    const items = parseFeed(await res.text());
    return { items, status: items.length ? 'ok' : 'empty' };
  } catch (e) {
    return { items: [], status: `error: ${e.message}` };
  }
}

// ── Build the payload ─────────────────────────────────────────────────────

export async function buildSports() {
  const sources = [...TEAMS, NORTHWESTERN];
  const feedUrls = [...new Set([...sources.map(s => s.feed), ...LEAGUE_FEEDS.map(l => l.feed)])];

  const fetched = await Promise.all(feedUrls.map(getFeed));
  const byUrl = Object.fromEntries(feedUrls.map((u, i) => [u, fetched[i].items]));

  // What each feed actually returned. Check this first when a team goes missing.
  // Named feedStatus, not sources — `sources` is already the team-config list
  // above, and two consts of the same name in one scope is a syntax error.
  const feedStatus = {};
  feedUrls.forEach((u, i) => {
    const name = u.includes('news.google') ? 'google-news (northwestern)'
               : u.replace('https://www.nytimes.com/athletic/rss/', 'athletic/');
    feedStatus[name] = `${fetched[i].status} · ${fetched[i].items.length} items`;
  });

  const seen = new Set();
  const teamItems = [];

  for (const src of sources) {
    const matches = [];
    for (const item of byUrl[src.feed] || []) {
      if (isLiveBlog(item.url) || !isFresh(item.date)) continue;
      const how = matchTeam(item, src);
      if (!how) continue;
      if (seen.has(item.url)) continue;

      let title = item.title;
      if (src.googleNews) title = title.replace(/\s+-\s+[^-]+$/, '').trim();

      matches.push({
        title, desc: item.desc, url: item.url,
        team: src.label, league: src.league,
        date: item.date, confidence: how,
      });
    }
    // Newest first, then cap. Sorting before capping matters — feed order is
    // not guaranteed, so taking the first N raw could hand you the oldest N.
    matches.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    for (const m of matches.slice(0, src.cap ?? 3)) {
      seen.add(m.url);
      teamItems.push(m);
    }
  }

  // Slug matches are more trustworthy than title matches, so they sort first;
  // within each tier, newest wins.
  const rank = { slug: 0, title: 1 };
  teamItems.sort((a, b) =>
    (rank[a.confidence] - rank[b.confidence]) || (Date.parse(b.date) - Date.parse(a.date)));

  const leagueItems = [];
  for (const lf of LEAGUE_FEEDS) {
    for (const item of (byUrl[lf.feed] || []).slice(0, 30)) {
      if (isLiveBlog(item.url) || !isFresh(item.date, 24)) continue;
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      leagueItems.push({
        title: item.title, desc: item.desc, url: item.url,
        team: null, league: lf.league, date: item.date,
      });
    }
  }
  leagueItems.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));

  return {
    generated: new Date().toISOString(),
    source: 'The Athletic / Google News',
    sources: feedStatus,
    teams: teamItems.slice(0, 12),
    league: leagueItems.slice(0, 12),
  };
}

// ── Route handler ─────────────────────────────────────────────────────────
// Drop this branch into your existing fetch handler, before the briefing
// routes. Everything else in the Worker stays as it is.

export async function handleSports(request, ctx) {
  const cache = caches.default;
  // Query string is part of the key, so /sports?t=2 forces a fresh build.
  // Without a query string it's one shared entry, as before.
  const u = new URL(request.url);
  const cacheKey = new Request(u.origin + '/sports' + u.search, { method: 'GET' });

  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const payload = await buildSports();

  const res = new Response(JSON.stringify(payload), {
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'cache-control': `public, max-age=${CACHE_SECONDS}`,
    },
  });

  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

// ═══════════════════════════════════════════════════════════════════════
//  /calendar route — drop-in block for briefing.clintsievers.workers.dev
// ═══════════════════════════════════════════════════════════════════════
//
//  SAVE A COPY OF THE WORKER BEFORE PASTING THIS. No version history.
//
//  Two edits to the Worker:
//
//  1. Paste this whole block at the TOP LEVEL of the file, above
//     `export default { ... }`. It declares exactly one top-level name —
//     `CALENDAR` — so it cannot collide with anything already in there.
//
//  2. Add one line to the router in your fetch handler, alongside the
//     existing /sports case. If it looks like this:
//
//         if (url.pathname === '/sports') return handleSports(request, env);
//
//     then add:
//
//         if (url.pathname === '/calendar') return CALENDAR.handle(request, env);
//
//  Environment variables (Settings → Variables and Secrets — these are
//  separate from the code editor, and changing them needs no redeploy):
//
//      CAL_ICS_1   your Google secret iCal URL
//      CAL_ICS_2   leave unset for now — the slot for the iCloud calendar
//
//  Store both as Secrets, not plaintext variables.
// ═══════════════════════════════════════════════════════════════════════

const CALENDAR = (() => {
  const TZ = 'America/Chicago';
  const CACHE_SECONDS = 300;

  // ── ICS text handling ────────────────────────────────────────────────

  // A line beginning with space or tab continues the previous one. Google
  // wraps at 75 octets, so any title of normal length arrives folded.
  const unfold = t =>
    t.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '');

  const unescapeText = s => s
    .replace(/\\n/gi, ' ')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();

  function parseLine(line) {
    const colon = line.indexOf(':');
    if (colon === -1) return null;
    const parts = line.slice(0, colon).split(';');
    const params = {};
    for (const p of parts.slice(1)) {
      const eq = p.indexOf('=');
      if (eq > -1) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
    }
    return { name: parts[0].toUpperCase(), params, value: line.slice(colon + 1) };
  }

  // ── Time ─────────────────────────────────────────────────────────────

  const dtfCache = new Map();
  function dtf(timeZone) {
    if (!dtfCache.has(timeZone)) {
      dtfCache.set(timeZone, new Intl.DateTimeFormat('en-US', {
        timeZone, hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      }));
    }
    return dtfCache.get(timeZone);
  }

  function partsIn(ms, timeZone) {
    const p = {};
    for (const { type, value } of dtf(timeZone).formatToParts(ms)) {
      if (type !== 'literal') p[type] = value;
    }
    return {
      y: +p.year, m: +p.month, d: +p.day,
      h: +(p.hour === '24' ? '00' : p.hour), mi: +p.minute, s: +p.second,
    };
  }

  // Wall-clock time in a named zone → UTC instant. Guess, measure the
  // error, correct. Two passes settles the DST boundaries; this is why a
  // 9am standing meeting stays 9am on the far side of November.
  function zonedToUTC(y, m, d, h, mi, s, timeZone) {
    const target = Date.UTC(y, m - 1, d, h, mi, s);
    let guess = target;
    for (let i = 0; i < 2; i++) {
      const g = partsIn(guess, timeZone);
      const diff = target - Date.UTC(g.y, g.m - 1, g.d, g.h, g.mi, g.s);
      if (diff === 0) break;
      guess += diff;
    }
    return guess;
  }

  function dateStrIn(ms, timeZone) {
    const p = partsIn(ms, timeZone);
    return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
  }

  // All-day events keep their raw date string. Their timestamp is not the
  // fact; the date is. Round-tripping them through a UTC instant is how
  // all-day events end up rendering on the wrong day.
  function parseDateValue(value, params) {
    if (params.VALUE === 'DATE' || /^\d{8}$/.test(value)) {
      const y = +value.slice(0, 4), m = +value.slice(4, 6), d = +value.slice(6, 8);
      return {
        allDay: true,
        dateStr: `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`,
        ms: zonedToUTC(y, m, d, 12, 0, 0, TZ),
      };
    }
    const mt = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
    if (!mt) return null;
    const [, Y, M, D, h, mi, s, z] = mt;
    return {
      allDay: false,
      ms: z ? Date.UTC(+Y, +M - 1, +D, +h, +mi, +s)
            : zonedToUTC(+Y, +M, +D, +h, +mi, +s, params.TZID || TZ),
    };
  }

  // ── Recurrence ───────────────────────────────────────────────────────
  // A recurring event appears ONCE in the file. DTSTART is the FIRST
  // occurrence, not today's. Filtering on DTSTART silently drops every
  // standing meeting, and an empty card is indistinguishable from a free
  // day — which is why this expander exists rather than a date comparison.

  const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

  function parseRRule(value) {
    const r = {};
    for (const kv of value.split(';')) {
      const [k, v] = kv.split('=');
      if (k) r[k.toUpperCase()] = v;
    }
    return r;
  }

  function expand(ev, winStart, winEnd) {
    const PAD = 86400000;
    if (!ev.rrule) {
      return (ev.start.ms >= winStart - PAD && ev.start.ms < winEnd + PAD)
        ? [ev.start] : [];
    }

    const r = parseRRule(ev.rrule);
    const freq = (r.FREQ || '').toUpperCase();
    const interval = Math.max(1, parseInt(r.INTERVAL || '1', 10));
    const count = r.COUNT ? parseInt(r.COUNT, 10) : null;
    const until = r.UNTIL ? (parseDateValue(r.UNTIL, {})?.ms ?? null) : null;
    const byDay = r.BYDAY
      ? r.BYDAY.split(',').map(t => t.replace(/^[-+]?\d+/, '').toUpperCase())
      : null;

    const base = partsIn(ev.start.ms, TZ);
    const hits = [];
    let emitted = 0;

    // Bounded on purpose: an RRULE with no COUNT and no UNTIL is legal and
    // infinite. Walk forward in the rule's own units and stop at the window.
    const MAX_STEPS = 4000;
    for (let step = 0; step < MAX_STEPS; step++) {
      let cand;
      if (freq === 'DAILY')        cand = new Date(Date.UTC(base.y, base.m - 1, base.d + step * interval));
      else if (freq === 'WEEKLY')  cand = new Date(Date.UTC(base.y, base.m - 1, base.d + step * 7 * interval));
      else if (freq === 'MONTHLY') cand = new Date(Date.UTC(base.y, base.m - 1 + step * interval, base.d));
      else if (freq === 'YEARLY')  cand = new Date(Date.UTC(base.y + step * interval, base.m - 1, base.d));
      else return [ev.start];

      const dayCandidates = [];
      if (freq === 'WEEKLY' && byDay) {
        const weekStart = cand.getUTCDate() - cand.getUTCDay();
        for (const d of byDay) {
          const idx = DAYS.indexOf(d);
          if (idx > -1) dayCandidates.push(new Date(Date.UTC(
            cand.getUTCFullYear(), cand.getUTCMonth(), weekStart + idx)));
        }
      } else {
        dayCandidates.push(cand);
      }
      dayCandidates.sort((a, b) => a - b);

      let pastWindow = true;
      for (const dc of dayCandidates) {
        const y = dc.getUTCFullYear(), m = dc.getUTCMonth() + 1, d = dc.getUTCDate();
        const ms = ev.start.allDay
          ? zonedToUTC(y, m, d, 12, 0, 0, TZ)
          : zonedToUTC(y, m, d, base.h, base.mi, base.s, TZ);

        if (ms < ev.start.ms - 1000) continue;
        if (until !== null && ms > until) continue;
        if (count !== null && emitted >= count) continue;
        emitted++;
        if (ms >= winEnd + PAD) continue;
        pastWindow = false;
        if (ms < winStart - PAD) continue;

        const dateStr = ev.start.allDay
          ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
          : null;
        const exKey = dateStr || (dateStrIn(ms, TZ) + 'T' + ms);
        if (!ev.exdates.has(exKey)) hits.push({ ms, allDay: ev.start.allDay, dateStr });
      }

      if (count !== null && emitted >= count) break;
      if (pastWindow && step > 0) break;
      if (until !== null && dayCandidates.every(dc =>
        Date.UTC(dc.getUTCFullYear(), dc.getUTCMonth(), dc.getUTCDate()) > until + PAD)) break;
    }
    return hits;
  }

  // ── Parse ────────────────────────────────────────────────────────────

  function parseICS(text) {
    const events = [];
    let cur = null;
    for (const raw of unfold(text).split('\n')) {
      const line = raw.trim();
      if (line === 'BEGIN:VEVENT') { cur = { exdates: new Set() }; continue; }
      if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
      if (!cur) continue;

      const p = parseLine(line);
      if (!p) continue;

      switch (p.name) {
        case 'SUMMARY':  cur.summary = unescapeText(p.value); break;
        case 'LOCATION': cur.location = unescapeText(p.value); break;
        case 'STATUS':   cur.status = p.value.toUpperCase(); break;
        case 'UID':      cur.uid = p.value; break;
        case 'RRULE':    cur.rrule = p.value; break;
        case 'DTSTART':  cur.start = parseDateValue(p.value, p.params); break;
        case 'DTEND':    cur.end = parseDateValue(p.value, p.params); break;
        case 'EXDATE':
          for (const v of p.value.split(',')) {
            const d = parseDateValue(v.trim(), p.params);
            if (d) cur.exdates.add(d.allDay ? d.dateStr : dateStrIn(d.ms, TZ) + 'T' + d.ms);
          }
          break;
        case 'RECURRENCE-ID': {
          const d = parseDateValue(p.value, p.params);
          if (d) cur.recurrenceId = d;
          break;
        }
      }
    }
    return events.filter(e => e.start);
  }

  function eventsOnDay(text, dayStr, sourceLabel) {
    const [Y, M, D] = dayStr.split('-').map(Number);
    const winStart = zonedToUTC(Y, M, D, 0, 0, 0, TZ);
    const winEnd   = zonedToUTC(Y, M, D + 1, 0, 0, 0, TZ);

    const all = parseICS(text);

    // A rescheduled instance arrives as its own VEVENT with the same UID
    // plus a RECURRENCE-ID naming the instance it replaces.
    const overrides = new Map();
    for (const e of all) {
      if (e.recurrenceId) {
        overrides.set(e.uid + '|' +
          (e.recurrenceId.dateStr || dateStrIn(e.recurrenceId.ms, TZ)), e);
      }
    }

    const out = [];
    const seen = new Set();

    const push = (ev, occ) => {
      if (!occ) return;
      if (ev.status === 'CANCELLED') return;
      const day = occ.allDay ? occ.dateStr : dateStrIn(occ.ms, TZ);
      if (day !== dayStr) return;

      const key = (ev.uid || ev.summary) + '|' + day + '|' + (occ.allDay ? 'all' : occ.ms);
      if (seen.has(key)) return;
      seen.add(key);

      const dur = (ev.end && !occ.allDay) ? ev.end.ms - ev.start.ms : 0;
      out.push({
        title: ev.summary || '(no title)',
        location: ev.location || null,
        allDay: occ.allDay,
        start: occ.allDay ? null : new Date(occ.ms).toISOString(),
        end: (occ.allDay || dur <= 0) ? null : new Date(occ.ms + dur).toISOString(),
        source: sourceLabel,
        sortKey: occ.allDay ? -1 : occ.ms,
      });
    };

    for (const ev of all) {
      // RECURRENCE-ID says WHICH instance this replaces; DTSTART says when
      // it now happens. Rendering the RECURRENCE-ID puts a rescheduled
      // meeting back at its old time.
      if (ev.recurrenceId) { push(ev, ev.start); continue; }
      for (const occ of expand(ev, winStart, winEnd)) {
        const day = occ.allDay ? occ.dateStr : dateStrIn(occ.ms, TZ);
        if (overrides.has(ev.uid + '|' + day)) continue;
        push(ev, occ);
      }
    }
    // `total` is how many VEVENTs the file contained at all. Without it,
    // "we downloaded a file we could not read" and "you have a free day"
    // produce the same response.
    return { events: out, total: all.length };
  }

  // ── Handler ──────────────────────────────────────────────────────────

  async function build(env, dayStr) {
    const today = dayStr || dateStrIn(Date.now(), TZ);

    // Two slots. The second is wired and empty, waiting on the iCloud URL.
    const feeds = [
      { label: 'google', url: env.CAL_ICS_1 },
      { label: 'icloud', url: env.CAL_ICS_2 },
    ];

    const events = [];
    const sources = {};

    for (const feed of feeds) {
      if (!feed.url) { sources[feed.label] = 'unset'; continue; }
      try {
        const res = await fetch(feed.url, {
          headers: { 'User-Agent': 'clint-dashboard/1.0' },
        });
        if (!res.ok) { sources[feed.label] = `HTTP ${res.status}`; continue; }
        const text = await res.text();
        if (!text.includes('BEGIN:VCALENDAR')) { sources[feed.label] = 'not-ics'; continue; }
        const { events: found, total } = eventsOnDay(text, today, feed.label);
        events.push(...found);
        sources[feed.label] = total === 0
          ? 'empty-file'                      // downloaded, but nothing in it
          : `ok (${total} in file, ${found.length} on ${today})`;
      } catch (e) {
        sources[feed.label] = `error: ${e.message}`;
      }
    }

    events.sort((a, b) => a.sortKey - b.sortKey);

    // `sources` is the same lesson as the /sports route: without it, a
    // blocked feed and a genuinely empty day are the same JSON.
    return {
      date: today,
      timezone: TZ,
      count: events.length,
      events: events.map(({ sortKey, ...rest }) => rest),
      sources,
      generated: new Date().toISOString(),
    };
  }

  async function handle(request, env) {
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'content-type': 'application/json; charset=utf-8',
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'GET only' }), { status: 405, headers: cors });
    }

    // Cache keyed on the full URL, so /calendar?t=N forces a rebuild.
    const cache = caches.default;
    const cacheKey = new Request(new URL(request.url).toString(), { method: 'GET' });
    const hit = await cache.match(cacheKey);
    if (hit) return hit;

    // ?date=YYYY-MM-DD points the route at another day. For checking that
    // parsing works without waiting for a morning to arrive.
    const q = new URL(request.url).searchParams.get('date');
    const dayStr = /^\d{4}-\d{2}-\d{2}$/.test(q || '') ? q : null;

    const data = await build(env, dayStr);
    const res = new Response(JSON.stringify(data), {
      headers: { ...cors, 'cache-control': `public, max-age=${CACHE_SECONDS}` },
    });
    await cache.put(cacheKey, res.clone());
    return res;
  }

  return { handle };
})();

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/sports') return handleSports(request, ctx);
    if (url.pathname === '/calendar') return CALENDAR.handle(request, env); 

    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Write-Key",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    if (request.method === "GET") {
      const data = await env.BRIEFING.get("latest");
      return new Response(data || "{}", {
        status: data ? 200 : 404,
        headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }

    if (request.method === "PUT") {
      if (request.headers.get("X-Write-Key") !== env.WRITE_KEY) {
        return new Response("Forbidden", { status: 403, headers: cors });
      }
      const body = await request.text();
      try { JSON.parse(body); } catch { return new Response("Invalid JSON", { status: 400, headers: cors }); }
      await env.BRIEFING.put("latest", body);
      return new Response("OK", { headers: cors });
    }

    return new Response("Method not allowed", { status: 405, headers: cors });
  },
};