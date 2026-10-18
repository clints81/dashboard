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
//  Read key — shared by /calendar and /tasks
// ═══════════════════════════════════════════════════════════════════════
//
//  READ_KEY is a Secret (Settings → Variables and Secrets). The page sends
//  it as X-Read-Key; each device enters it once and keeps it in browser
//  storage, so it never sits in the public JS. Every other route is public.
//
//  Order inside a protected route: OPTIONS first (preflights never carry
//  the key), then check(), then the method check and the cache. Checking
//  before the cache lookup is the point — a request without the key must
//  never be handed a cached copy.
// ═══════════════════════════════════════════════════════════════════════

const READ_GATE = (() => {
  // Returns the refusal to send, or null when the request may read. The
  // refusal carries the route's CORS headers: without them the browser hides
  // the 401 and "locked" looks like a network failure.
  function check(request, env, cors) {
    const deny = (status, auth) => new Response(
      JSON.stringify({ error: 'locked', sources: { auth } }),
      { status, headers: { ...cors, 'cache-control': 'no-store' } });

    if (!env.READ_KEY) return deny(500, 'READ_KEY unset');   // fail closed
    const sent = request.headers.get('X-Read-Key');
    if (!sent) return deny(401, 'missing');
    if (sent !== env.READ_KEY) return deny(401, 'rejected');
    return null;
  }

  // The copy in caches.default keeps `public, max-age` on purpose: cache.put
  // refuses (413) a response whose Cache-Control says not to store it, and
  // Cloudflare reads both `private` and `no-store` that way. So the cache
  // gets the public copy and the browser gets this one.
  function forBrowser(res) {
    const out = new Response(res.body, res);
    out.headers.set('cache-control', 'private, no-store');
    return out;
  }

  return { check, forBrowser };
})();

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

  // A parameter value holding `:` or `;` must be quoted
  // (TZID="GMT-05:00"), so split on the first colon outside quotes.
  function parseLine(line) {
    let colon = -1, inQ = false;
    const cuts = [];
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') inQ = !inQ;
      else if (!inQ && c === ';') cuts.push(i);
      else if (!inQ && c === ':') { colon = i; break; }
    }
    if (colon === -1) return null;
    const bounds = [-1, ...cuts, colon];
    const parts = bounds.slice(0, -1).map((b, i) => line.slice(b + 1, bounds[i + 1]));
    const params = {};
    for (const p of parts.slice(1)) {
      const eq = p.indexOf('=');
      if (eq > -1) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"(.*)"$/, '$1');
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

  // ── Which zone a TZID means ──────────────────────────────────────────
  // Apple exports zones it can't name as `GMT-0500`, `GMT+0200`. Intl
  // throws on those, and before this one such event took down the whole
  // feed. Checked against the family feed (2026-10-18): every GMT label's
  // VTIMEZONE is a single fixed offset with no daylight rule, so the label
  // is read as exactly that offset. The stated offset is authoritative; our
  // guess that "GMT-0500" really meant Chicago is not. Arithmetic, not
  // Etc/GMT±N, whose sign runs backwards.

  const OFFSET_RE = /^(?:(?:GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?|([+-])(\d{2}):?(\d{2}))$/i;

  function fixedOffsetMinutes(tzid) {
    const mt = tzid.match(OFFSET_RE);
    if (!mt) return null;
    const [sign, h, m] = mt[1] ? [mt[1], mt[2], mt[3]] : [mt[4], mt[5], mt[6]];
    return (sign === '-' ? -1 : 1) * (+h * 60 + +(m || 0));
  }

  const ianaOk = new Map();
  function isIana(tzid) {
    if (!ianaOk.has(tzid)) {
      try { dtf(tzid); ianaOk.set(tzid, true); } catch { ianaOk.set(tzid, false); }
    }
    return ianaOk.get(tzid);
  }

  // → { zone } for a named zone, { offset } (minutes east of UTC) for a
  // fixed offset. A name that is neither falls back to Chicago, flagged so
  // the event is counted in `sources`.
  function resolveZone(tzid) {
    const id = (tzid || '').replace(/^"|"$/g, '').trim();
    if (!id) return { zone: TZ };
    const offset = fixedOffsetMinutes(id);
    if (offset !== null) return { offset };
    if (isIana(id)) return { zone: id };
    return { zone: TZ, fallback: true };
  }

  // The two conversions the parser and the expander need, for either kind.
  const wallToUTC = (y, m, d, h, mi, s, z) => z.offset !== undefined
    ? Date.UTC(y, m - 1, d, h, mi, s) - z.offset * 60000
    : zonedToUTC(y, m, d, h, mi, s, z.zone);

  const wallParts = (ms, z) => {
    if (z.offset === undefined) return partsIn(ms, z.zone);
    const t = new Date(ms + z.offset * 60000);
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(),
             h: t.getUTCHours(), mi: t.getUTCMinutes(), s: t.getUTCSeconds() };
  };

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
    if (z) return { allDay: false, zone: { zone: TZ }, ms: Date.UTC(+Y, +M - 1, +D, +h, +mi, +s) };
    // `zone` rides along so a recurring event repeats in its own zone.
    const zone = resolveZone(params.TZID);
    return {
      allDay: false,
      zone,
      fallback: !!zone.fallback,
      ms: wallToUTC(+Y, +M, +D, +h, +mi, +s, zone),
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

    // Repeat in the event's own zone: a `GMT-0500` series stays at its
    // stated offset, a New York one at New York wall-clock.
    const zone = ev.start.allDay ? { zone: TZ } : (ev.start.zone || { zone: TZ });
    const base = wallParts(ev.start.ms, zone);
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
          : wallToUTC(y, m, d, base.h, base.mi, base.s, zone);

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

  // One bad event must not sink the feed. A line that throws marks its
  // event bad, and the event is skipped and counted rather than aborting
  // the parse. `vevents` counts every VEVENT, skipped ones included.
  function parseICS(text) {
    const events = [];
    let cur = null, vevents = 0, skipped = 0;
    for (const raw of unfold(text).split('\n')) {
      const line = raw.trim();
      if (line === 'BEGIN:VEVENT') { cur = { exdates: new Set() }; vevents++; continue; }
      if (line === 'END:VEVENT') {
        if (cur) {
          // No usable DTSTART is a skip too: dropping it quietly is exactly
          // the free-afternoon look-alike the count exists to expose.
          if (cur.bad || !cur.start || !Number.isFinite(cur.start.ms)) skipped++;
          else events.push(cur);
        }
        cur = null;
        continue;
      }
      if (!cur || cur.bad) continue;

      const p = parseLine(line);
      if (!p) continue;

      try { applyProp(cur, p); } catch { cur.bad = true; }
    }
    return { events, vevents, skipped };
  }

  function applyProp(cur, p) {
    switch (p.name) {
      case 'SUMMARY':  cur.summary = unescapeText(p.value); break;
      case 'LOCATION': cur.location = unescapeText(p.value); break;
      case 'STATUS':   cur.status = p.value.toUpperCase(); break;
      case 'UID':      cur.uid = p.value; break;
      case 'RRULE':    cur.rrule = p.value; break;
      case 'DTSTART':
        cur.start = parseDateValue(p.value, p.params);
        if (cur.start?.fallback) cur.fallback = true;
        break;
      case 'DTEND':
        cur.end = parseDateValue(p.value, p.params);
        if (cur.end?.fallback) cur.fallback = true;
        break;
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

  function eventsOnDay(text, dayStr, sourceLabel) {
    const [Y, M, D] = dayStr.split('-').map(Number);
    const winStart = zonedToUTC(Y, M, D, 0, 0, 0, TZ);
    const winEnd   = zonedToUTC(Y, M, D + 1, 0, 0, 0, TZ);

    const parsed = parseICS(text);
    let skipped = parsed.skipped;
    const bad = new Set();
    const skip = ev => { if (!bad.has(ev)) { bad.add(ev); skipped++; } };

    // A rescheduled instance arrives as its own VEVENT with the same UID
    // plus a RECURRENCE-ID naming the instance it replaces.
    const overrides = new Map();
    for (const e of parsed.events) {
      if (!e.recurrenceId) continue;
      try {
        overrides.set(e.uid + '|' +
          (e.recurrenceId.dateStr || dateStrIn(e.recurrenceId.ms, TZ)), e);
      } catch { skip(e); }
    }
    const all = parsed.events.filter(e => !bad.has(e));

    const out = [];
    const seen = new Set();

    const push = (ev, occ, into) => {
      if (!occ) return;
      if (ev.status === 'CANCELLED') return;
      const day = occ.allDay ? occ.dateStr : dateStrIn(occ.ms, TZ);
      if (day !== dayStr) return;

      const key = (ev.uid || ev.summary) + '|' + day + '|' + (occ.allDay ? 'all' : occ.ms);
      if (seen.has(key)) return;

      const dur = (ev.end && !occ.allDay) ? ev.end.ms - ev.start.ms : 0;
      into.push({
        key,
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
      // Each event is built into its own list and merged only if it got
      // through whole, so one that throws halfway leaves nothing behind.
      const mine = [];
      try {
        // RECURRENCE-ID says WHICH instance this replaces; DTSTART says when
        // it now happens. Rendering the RECURRENCE-ID puts a rescheduled
        // meeting back at its old time.
        if (ev.recurrenceId) push(ev, ev.start, mine);
        else for (const occ of expand(ev, winStart, winEnd)) {
          const day = occ.allDay ? occ.dateStr : dateStrIn(occ.ms, TZ);
          if (overrides.has(ev.uid + '|' + day)) continue;
          push(ev, occ, mine);
        }
      } catch { skip(ev); continue; }
      for (const { key, ...e } of mine) {
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(e);
      }
    }
    // `total` is how many VEVENTs the file contained at all. Without it,
    // "we downloaded a file we could not read" and "you have a free day"
    // produce the same response. `skipped` and `fallback` count across the
    // whole file, not just the day: a skipped event's date can't be known.
    const fallback = all.filter(e => e.fallback && !bad.has(e)).length;
    return { events: out, total: parsed.vevents, skipped, fallback };
  }

  // ── Handler ──────────────────────────────────────────────────────────

  async function build(env, dayStr) {
    const today = dayStr || dateStrIn(Date.now(), TZ);

    // Two slots: Google, and the family Apple calendar (live since 2026-10-18).
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
        const { events: found, total, skipped, fallback } = eventsOnDay(text, today, feed.label);
        events.push(...found);
        // The skip count is the important one: without it, a dropped event
        // and a free afternoon look identical. Zero counts are left out so
        // a healthy feed reads as it always has.
        const extra = (skipped ? `, ${skipped} skipped` : '')
                    + (fallback ? `, ${fallback} fallback` : '');
        sources[feed.label] = total === 0
          ? 'empty-file'                      // downloaded, but nothing in it
          : `ok (${total} in file, ${found.length} on ${today}${extra})`;
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
      'access-control-allow-headers': 'X-Read-Key',
      'content-type': 'application/json; charset=utf-8',
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    const locked = READ_GATE.check(request, env, cors);
    if (locked) return locked;
    if (request.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'GET only' }), { status: 405, headers: cors });
    }

    // Cache keyed on the full URL, so /calendar?t=N forces a rebuild.
    const cache = caches.default;
    const cacheKey = new Request(new URL(request.url).toString(), { method: 'GET' });
    const hit = await cache.match(cacheKey);
    if (hit) return READ_GATE.forBrowser(hit);

    // ?date=YYYY-MM-DD points the route at another day. For checking that
    // parsing works without waiting for a morning to arrive.
    const q = new URL(request.url).searchParams.get('date');
    const dayStr = /^\d{4}-\d{2}-\d{2}$/.test(q || '') ? q : null;

    const data = await build(env, dayStr);
    const res = new Response(JSON.stringify(data), {
      headers: { ...cors, 'cache-control': `public, max-age=${CACHE_SECONDS}` },
    });
    await cache.put(cacheKey, res.clone());
    return READ_GATE.forBrowser(res);
  }

  return { handle };
})();

// ═══════════════════════════════════════════════════════════════════════
//  /tasks route — JELC treasurer tasks from Notion
// ═══════════════════════════════════════════════════════════════════════
//
//  SAVE A COPY OF THE WORKER BEFORE PASTING THIS. (Git now holds the
//  history — commit worker.js first, then paste this whole file into the
//  Cloudflare editor and deploy. Never edit in the Cloudflare editor, or
//  the deployed Worker and the repo drift apart.)
//
//  One top-level name — TASKS — plus one router line below, alongside the
//  /sports and /calendar cases:
//
//      if (url.pathname === '/tasks') return TASKS.handle(request, env);
//
//  Environment (Settings → Variables and Secrets, separate from the code
//  editor, no redeploy needed to change):
//
//      NOTION_TOKEN   integration token, stored as a Secret. A 404 from the
//                     query almost always means the integration hasn't been
//                     granted access to the database, not a bad ID.
//
//  Notion facts (verified 2026-09-03, do not substitute from memory):
//    - The 2025-09-03 API moved queries onto /v1/data_sources/{id}/query.
//      The id below is the DATA SOURCE id, not the id in the Notion URL.
//    - `Completion Date` is empty on every row — do NOT build "settled" on
//      it. "Recently settled" = due in the last 7 days AND now Paid/Complete.
//    - `Days Left`, `Priority`, `Due In`, `Archive?`, `Auto Due Date` are
//      formulas, not exposed to the query layer. daysUntil is computed here.
// ═══════════════════════════════════════════════════════════════════════

const TASKS = (() => {
  const TZ = 'America/Chicago';
  const CACHE_SECONDS = 300;
  const DATA_SOURCE_ID = '1a0f8d21-7e64-8041-96ed-000b1d9f7f86';
  const NOTION_VERSION = '2025-09-03';
  const DAY_MS = 24 * 60 * 60 * 1000;

  // "Today" as the Chicago calendar date, anchored to UTC midnight so day
  // arithmetic below is plain integer math. The /calendar block does the
  // same thing with its dateStrIn helper; this is the minimal version.
  function chicagoToday() {
    const p = {};
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    });
    for (const { type, value } of dtf.formatToParts(Date.now())) {
      if (type !== 'literal') p[type] = value;
    }
    return { y: +p.year, m: +p.month, d: +p.day };
  }

  const ymd = ms => new Date(ms).toISOString().slice(0, 10); // ms is a UTC-midnight instant

  async function query(env, body) {
    try {
      const res = await fetch(
        `https://api.notion.com/v1/data_sources/${DATA_SOURCE_ID}/query`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.NOTION_TOKEN}`,
            'Notion-Version': NOTION_VERSION,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ...body, page_size: 100 }),
        }
      );
      if (!res.ok) return { ok: false, status: `HTTP ${res.status}` };
      const json = await res.json();
      return { ok: true, rows: json.results || [] };
    } catch (e) {
      return { ok: false, status: `error: ${e.message}` };
    }
  }

  // ── Property extraction — names are exact, from the live schema ─────────
  const titleOf   = p => (p?.['Task Name']?.title || []).map(t => t.plain_text).join('').trim();
  const dueOf     = p => p?.['Due Date']?.date?.start?.slice(0, 10) || null;
  const statusOf  = p => p?.['Status']?.status?.name || '';
  const catOf     = p => p?.['Category']?.select?.name || '';

  function build(todayMs, todayStr, a, b) {
    // Query A — overdue plus the next 7 days, not yet settled. No lower
    // bound on the date is deliberate: that's what lets overdue through.
    const due = a.rows.map(page => {
      const due = dueOf(page.properties);
      const daysUntil = due
        ? Math.round((Date.UTC(+due.slice(0, 4), +due.slice(5, 7) - 1, +due.slice(8, 10)) - todayMs) / DAY_MS)
        : null;
      return {
        title: titleOf(page.properties),
        due,
        daysUntil,
        overdue: daysUntil !== null && daysUntil < 0,
        status: statusOf(page.properties),
        category: catOf(page.properties),
        url: page.url,
      };
    });

    // Query B — due in the last 7 days and now Paid/Complete.
    const done = b.rows.map(page => ({
      title: titleOf(page.properties),
      due: dueOf(page.properties),
      status: statusOf(page.properties),
      category: catOf(page.properties),
      url: page.url,
    }));

    return {
      date: todayStr,
      timezone: TZ,
      due,
      done,
      counts: { due: due.length, overdue: due.filter(t => t.overdue).length, done: done.length },
      // Required, same lesson as /sports and /calendar: an expired token, a
      // revoked integration, and a genuinely clear week must not look alike.
      sources: { notion: a.ok && b.ok ? `ok (${a.rows.length + b.rows.length} rows)` : (a.status || b.status) },
      generated: new Date().toISOString(),
    };
  }

  async function handle(request, env) {
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'X-Read-Key',
      'content-type': 'application/json; charset=utf-8',
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    const locked = READ_GATE.check(request, env, cors);
    if (locked) return locked;
    if (request.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'GET only' }), { status: 405, headers: cors });
    }

    // Cache keyed on the full URL, so /tasks?t=N forces a rebuild.
    const cache = caches.default;
    const cacheKey = new Request(new URL(request.url).toString(), { method: 'GET' });
    const hit = await cache.match(cacheKey);
    if (hit) return READ_GATE.forBrowser(hit);

    // ?date=YYYY-MM-DD points the route at another day, for verifying the
    // filters without waiting for a morning to arrive.
    const q = new URL(request.url).searchParams.get('date');
    let today;
    if (/^\d{4}-\d{2}-\d{2}$/.test(q || '')) {
      today = { y: +q.slice(0, 4), m: +q.slice(5, 7), d: +q.slice(8, 10) };
    } else {
      today = chicagoToday();
    }
    const todayMs  = Date.UTC(today.y, today.m - 1, today.d);
    const todayStr = ymd(todayMs);
    const plus7    = ymd(todayMs + 7 * DAY_MS);
    const minus7   = ymd(todayMs - 7 * DAY_MS);

    const [a, b] = await Promise.all([
      query(env, {
        filter: {
          and: [
            { property: 'Due Date', date: { on_or_before: plus7 } },
            { property: 'Status', status: { does_not_equal: 'Paid' } },
            { property: 'Status', status: { does_not_equal: 'Complete' } },
          ],
        },
        sorts: [{ property: 'Due Date', direction: 'ascending' }],
      }),
      query(env, {
        filter: {
          and: [
            { property: 'Due Date', date: { on_or_after: minus7 } },
            { property: 'Due Date', date: { on_or_before: todayStr } },
            { or: [
              { property: 'Status', status: { equals: 'Paid' } },
              { property: 'Status', status: { equals: 'Complete' } },
            ]},
          ],
        },
        sorts: [{ property: 'Due Date', direction: 'descending' }],
      }),
    ]);

    const data = build(todayMs, todayStr, a, b);
    const res = new Response(JSON.stringify(data), {
      headers: { ...cors, 'cache-control': `public, max-age=${CACHE_SECONDS}` },
    });
    await cache.put(cacheKey, res.clone());
    return READ_GATE.forBrowser(res);
  }

  return { handle };
})();

// ═══════════════════════════════════════════════════════════════════════
//  /devotion route — WELS Daily Devotion (verse + short excerpt)
// ═══════════════════════════════════════════════════════════════════════
//
//  One top-level name — DEVOTION — plus one router line below.
//
//  Source: the official WELS Daily Devotions RSS feed. No key, no secret —
//  a public feed, fetched server-side like /sports (the browser can't read
//  wels.net cross-origin). Each item follows a fixed template: first
//  paragraph is the scripture (verse text, then the reference on its own
//  line), the next paragraphs are the reflection, then a prayer, then
//  WELS/licensing boilerplate. We surface the verse, the reference, the
//  devotion title, and the first sentence or two of the reflection, plus a
//  read link (the item page) and a listen link (the mp3 enclosure).
// ═══════════════════════════════════════════════════════════════════════

const DEVOTION = (() => {
  const CACHE_SECONDS = 3 * 60 * 60; // devotions update once a day (~05:30 UTC)
  const FEED = 'https://wels.net/dev-daily/feed/pt-dev-daily';

  // Scripture reference, e.g. "Romans 8:24", "1 Corinthians 13:4-7",
  // "Song of Songs 2:1", "John 3:16-17,19".
  const REF_RE = /((?:[1-3]\s)?[A-Z][a-zA-Z]+(?:\s(?:of\s)?[A-Z][a-zA-Z]+)*\s\d{1,3}:\d{1,3}(?:[-–]\d{1,3})?(?:,\s?\d{1,3}(?:[-–]\d{1,3})?)*)/;

  function decode(s) {
    return s
      .replace(/<!\[CDATA\[|\]\]>/g, '')
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
      .replace(/&nbsp;/g, ' ')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  }

  const tag = (xml, name) => {
    const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
    return m ? decode(m[1]).trim() : '';
  };

  // Cleaned, non-empty <p> texts, with <br> preserved as newlines.
  function paragraphs(desc) {
    let b = desc.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '');
    b = b.replace(/<img\b[^>]*>/gi, '').replace(/<audio\b[\s\S]*?<\/audio>/gi, '');
    const out = [];
    const re = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
    let m;
    while ((m = re.exec(b))) {
      const t = decode(m[1].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''))
        .replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').trim();
      if (t) out.push(t);
    }
    return out;
  }

  const isBoiler = p =>
    /^listen to devotion$/i.test(p) ||
    /^Daily Devotions is brought to you by WELS/i.test(p) ||
    /^This work is licensed/i.test(p) ||
    /^All Scripture quotations/i.test(p);

  function parse(xml) {
    const item = (xml.match(/<item>[\s\S]*?<\/item>/) || [])[0];
    if (!item) return null;

    const fullTitle = tag(item, 'title');                    // "Saved In Hope – September 3, 2026"
    const title = fullTitle.split(/\s[–—-]\s/)[0].trim() || fullTitle;
    const readUrl = tag(item, 'link');
    const pubDate = tag(item, 'pubDate');
    const encl = item.match(/<enclosure\b[^>]*url="([^"]+)"/i);
    const audioUrl = encl ? encl[1] : '';

    const descM = item.match(/<description>([\s\S]*?)<\/description>/i);
    const paras = descM ? paragraphs(descM[1]).filter(p => !isBoiler(p)) : [];

    // Verse paragraph: text, then reference on its own line.
    const versePara = paras[0] || '';
    let verse = versePara, reference = '';
    const lines = versePara.split('\n').map(s => s.trim()).filter(Boolean);
    if (lines.length > 1 && REF_RE.test(lines[lines.length - 1])) {
      reference = lines.pop();
      verse = lines.join(' ');
    } else {
      const rm = versePara.match(REF_RE);
      if (rm) { reference = rm[1]; verse = versePara.replace(rm[1], '').trim(); }
    }
    verse = verse.replace(/\s+/g, ' ').replace(/\s+([,.;:])/g, '$1').trim();

    // Excerpt: first ~2 sentences of the reflection (the paragraph after the verse).
    const bodyPara = (paras[1] || '').replace(/\s+/g, ' ').trim();
    const sentences = bodyPara.match(/[^.!?]+[.!?]+/g) || (bodyPara ? [bodyPara] : []);
    let excerpt = sentences.slice(0, 2).join(' ').replace(/\s+/g, ' ').trim();
    if (excerpt.length > 240) excerpt = excerpt.slice(0, 240).replace(/\s+\S*$/, '') + '…';

    return { title, verse, reference, excerpt, readUrl, audioUrl, pubDate };
  }

  async function handle(request) {
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'content-type': 'application/json; charset=utf-8',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'GET only' }), { status: 405, headers: cors });
    }

    const cache = caches.default;
    const cacheKey = new Request(new URL(request.url).toString(), { method: 'GET' });
    const hit = await cache.match(cacheKey);
    if (hit) return hit;

    let data;
    try {
      const res = await fetch(FEED, { headers: { 'User-Agent': 'clint-dashboard/1.0' } });
      if (!res.ok) {
        data = { sources: { wels: `HTTP ${res.status}` }, generated: new Date().toISOString() };
      } else {
        const xml = await res.text();
        const parsed = parse(xml);
        data = parsed
          ? { ...parsed, source: 'WELS Daily Devotions',
              sources: { wels: parsed.verse ? 'ok' : 'parse-miss' },
              generated: new Date().toISOString() }
          : { sources: { wels: 'no-items' }, generated: new Date().toISOString() };
      }
    } catch (e) {
      data = { sources: { wels: `error: ${e.message}` }, generated: new Date().toISOString() };
    }

    const res = new Response(JSON.stringify(data), {
      headers: { ...cors, 'cache-control': `public, max-age=${CACHE_SECONDS}` },
    });
    await cache.put(cacheKey, res.clone());
    return res;
  }

  return { handle };
})();

// ═══════════════════════════════════════════════════════════════════════
//  /sitwith route — the archive of past "something to sit with" picks
// ═══════════════════════════════════════════════════════════════════════
//
//  One top-level name — SITWITH — plus one router line below, and one call
//  from the PUT branch (record).
//
//  Public, no read key: the picks aren't personal, and the computer
//  bookmark should show them.
//
//  Storage: KV key "sitwith-archive" in env.BRIEFING, a JSON array of
//  {date, day, type, headline, desc, source, read_time, url}, newest first,
//  one entry per date, capped at CAP.
//
//  Why the dashboard keeps its own copy instead of reading retrieval's
//  stored briefs: those expire after 45 days, and this Worker can't call
//  retrieval by URL on the same account (error 1042). The service binding
//  only runs retrieval → dashboard.
//
//  The PUT records BOTH the previous "latest" and the incoming one. If the
//  archive write fails one morning, the next morning's PUT catches it up.
// ═══════════════════════════════════════════════════════════════════════

const SITWITH = (() => {
  const KEY = 'sitwith-archive';
  const CAP = 60;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  // SEED: the picks from before the archive existed, copied from
  // retrieval's /brief/<date>?json (the sit_with block sent to the
  // dashboard). Delete after Oct 21, 2026, once the archive covers a week.
  const SEED = [
    { date: '2026-10-13', day: 'Tuesday', type: 'Memoir · World',
      headline: 'I was kidnapped and held hostage for 977 days. Could I forgive my captors?',
      desc: 'A journalist held 977 days by Somali pirates returns to one of his captors to test whether forgiveness is mercy or Stockholm syndrome — a rare, honest reckoning worth a quiet half-hour this morning.',
      source: 'The Guardian', read_time: '~23 min',
      url: 'https://www.theguardian.com/news/ng-interactive/2026/oct/13/i-was-kidnapped-and-held-hostage-for-977-days-could-i-forgive-my-captors' },
    { date: '2026-10-12', day: 'Monday', type: 'Interview · World',
      headline: 'She’s Been to Gaza. She Met With the Iranians. Now She Has a Warning.',
      desc: "With Ukraine truces collapsing and Houthi-Saudi strikes widening, the Red Cross chief who talks to both sides explains why she fears the world's wars are spiraling; a 17-minute read for this morning.",
      source: 'The New York Times', read_time: '~17 min',
      url: 'https://www.nytimes.com/2026/10/10/magazine/mirjana-spoljaric-interview.html' },
    { date: '2026-10-11', day: 'Sunday', type: 'Sunday long read · Longread · Culture',
      headline: 'Secret Billionaires, Mafia Brides, Alpha Kings: The Insane World of Microdramas',
      desc: "A reported tour of vertical phone soap operas, an industry that has quietly reshaped film and TV production and may soon need no human actors at all. It is a weekend read that makes this week's AI-agent headlines feel less abstract.",
      source: 'The New York Times', read_time: '~31 min',
      url: 'https://www.nytimes.com/2026/10/06/magazine/microdramas-tv-shows-hollywood-entertainment.html' },
    { date: '2026-10-10', day: 'Saturday', type: 'Longread · Health',
      headline: 'Dying Patients Are Inundated by Misinformation. My Dad Was One of Them.',
      desc: "A reporter's account of her father's cancer and the alternative clinics that drain dying patients' savings—worth the weekend for its mix of reporting and grief.",
      source: 'The New York Times', read_time: '~26 min',
      url: 'https://www.nytimes.com/2026/10/04/magazine/alternative-cancer-clinics-treatment-father.html' },
    { date: '2026-10-09', day: 'Friday', type: 'Longread · Science & Engineering',
      headline: 'How Test Engineers Decide What Counts as Good Enough',
      desc: "A curious, concrete tour of how engineers stage reality to decide what's safe enough, a good counterweight to a morning of AI and risk headlines.",
      source: 'The New Yorker', read_time: '~15 min',
      url: 'https://www.newyorker.com/magazine/2026/10/12/kobuk-the-destroyer-alex-davies-book-review' },
    { date: '2026-10-08', day: 'Thursday', type: 'Essay · World',
      headline: 'The Myth of Military Victory',
      desc: "With Houthi strikes widening and US forces pulling back across the region, this Foreign Affairs analysis of why decisive military victory is so often an illusion is a timely frame for this morning's headlines.",
      source: 'Foreign Affairs', read_time: '~17 min',
      url: 'https://www.foreignaffairs.com/united-states/myth-military-victory' },
  ];

  // A briefing body (string or object) → one archive entry, or null when it
  // has no pick. A failed night's briefing has no sit_with, so it never
  // replaces a pick already recorded for that date.
  function entryFrom(brief) {
    if (typeof brief === 'string') {
      try { brief = JSON.parse(brief); } catch { return null; }
    }
    const s = brief?.sit_with;
    if (!s || !DATE_RE.test(brief.date || '')) return null;
    const { type, headline, desc, source, read_time, url } = s;
    return { date: brief.date, day: brief.day || '', type, headline, desc, source, read_time, url };
  }

  // Later lists win for the same date. Newest first.
  function merge(...lists) {
    const byDate = new Map();
    for (const list of lists) for (const e of list) if (e) byDate.set(e.date, e);
    return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
  }

  // { items, status }. A KV error throws; a value that isn't a JSON array
  // comes back as status 'unreadable'.
  async function readArchive(env) {
    const raw = await env.BRIEFING.get(KEY);
    if (raw === null) return { items: [], status: 'ok' };
    try {
      const items = JSON.parse(raw);
      if (Array.isArray(items)) return { items, status: 'ok' };
    } catch {}
    return { items: [], status: 'unreadable' };
  }

  // Called by the PUT after "latest" is written. Throws on failure; the
  // caller turns that into the X-Sitwith-Archive header. An unreadable
  // archive is left alone rather than overwritten, so it can be inspected.
  async function record(env, briefs) {
    const incoming = briefs.map(entryFrom).filter(Boolean);
    if (!incoming.length) return;
    const { items, status } = await readArchive(env);
    if (status !== 'ok') throw new Error(`archive ${status}, not overwritten`);
    await env.BRIEFING.put(KEY, JSON.stringify(merge(items, incoming).slice(0, CAP)));
  }

  async function handle(request, env) {
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'GET only' }), { status: 405, headers: cors });
    }

    // Same lesson as the other routes: a broken archive and a quiet week
    // must not produce the same JSON.
    const sources = {};
    let archived = [];
    try {
      const a = await readArchive(env);
      archived = a.items;
      sources.archive = a.status === 'ok' ? `ok (${a.items.length})` : a.status;
    } catch (e) {
      sources.archive = `error: ${e.message}`;
    }

    let current = null;
    try {
      current = entryFrom(await env.BRIEFING.get('latest'));
      sources.latest = current ? 'ok' : 'no pick';
    } catch (e) {
      sources.latest = `error: ${e.message}`;
    }

    // Lowest to highest precedence, so items[0] is the pick in the hero card.
    let items = merge(SEED, archived, [current]);

    // ?days=N keeps picks dated within the last N days (Chicago), today included.
    const days = parseInt(new URL(request.url).searchParams.get('days') || '', 10);
    if (days > 0) {
      const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(Date.now());
      const t = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
      const from = new Date(t - (days - 1) * 86400000).toISOString().slice(0, 10);
      items = items.filter(e => e.date >= from);
    }

    return new Response(JSON.stringify({ items, sources, generated: new Date().toISOString() }),
      { headers: cors });
  }

  return { record, handle };
})();

// ═══════════════════════════════════════════════════════════════════════
//  /otf route — Orangetheory data from the otf-sync Action
// ═══════════════════════════════════════════════════════════════════════
//
//  One top-level name — OTF — plus one router line below.
//
//  otf-sync (a scheduled GitHub Action in the private clints81/otf-sync
//  repo) PUTs here with X-Write-Key, the same key as the briefing PUT.
//  Its body: {attempted_at, ok, sources, data?}. `ok` is false when the
//  login or the workout fetch failed, and then there's no `data`.
//
//  Storage: KV key "otf-sync" in env.BRIEFING, holding
//  {data, attempt: {at, ok, sources}}. A failed run updates `attempt` only,
//  so the card keeps the last good data AND says the sync failed. A failure
//  must never look like "no classes this week".
//
//  GET is behind the read key, same order as /calendar and /tasks: OPTIONS,
//  then READ_GATE.check(), then the cache. A PUT drops the cached copy.
// ═══════════════════════════════════════════════════════════════════════

const OTF = (() => {
  const KEY = 'otf-sync';
  const CACHE_SECONDS = 300;

  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, PUT, OPTIONS',
    'access-control-allow-headers': 'X-Read-Key, X-Write-Key, Content-Type',
    'content-type': 'application/json; charset=utf-8',
  };
  const reply = (status, obj) =>
    new Response(JSON.stringify(obj), { status, headers: { ...cors, 'cache-control': 'no-store' } });

  // { record, status }. A KV error throws; a value that isn't a JSON object
  // comes back as status 'unreadable'.
  async function read(env) {
    const raw = await env.BRIEFING.get(KEY);
    if (raw === null) return { record: null, status: 'empty' };
    try {
      const record = JSON.parse(raw);
      if (record && typeof record === 'object') return { record, status: 'ok' };
    } catch {}
    return { record: null, status: 'unreadable' };
  }

  function valid(body) {
    if (!body || typeof body !== 'object') return false;
    if (typeof body.attempted_at !== 'string' || typeof body.ok !== 'boolean') return false;
    if (!body.sources || typeof body.sources !== 'object') return false;
    if (body.ok && (!body.data || typeof body.data.fetched_at !== 'string')) return false;
    return true;
  }

  async function put(request, env) {
    if (request.headers.get('X-Write-Key') !== env.WRITE_KEY) return reply(403, { error: 'forbidden' });
    let body;
    try { body = JSON.parse(await request.text()); } catch { return reply(400, { error: 'invalid JSON' }); }
    if (!valid(body)) return reply(400, { error: 'expected {attempted_at, ok, sources, data?}' });

    // A failed run keeps the previous data. An unreadable record is
    // replaced: unlike the sit-with archive it holds nothing that isn't
    // fetched again on the next good run.
    let previous = null;
    try { previous = (await read(env)).record; } catch {}
    const record = {
      data: body.ok ? body.data : (previous?.data ?? null),
      attempt: { at: body.attempted_at, ok: body.ok, sources: body.sources },
    };
    await env.BRIEFING.put(KEY, JSON.stringify(record));
    await caches.default.delete(new Request(new URL('/otf', request.url).toString(), { method: 'GET' }));
    return reply(200, { ok: true, kept_previous: !body.ok });
  }

  async function handle(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method === 'PUT') return put(request, env);

    const locked = READ_GATE.check(request, env, cors);
    if (locked) return locked;
    if (request.method !== 'GET') return reply(405, { error: 'GET only' });

    const cache = caches.default;
    const cacheKey = new Request(new URL(request.url).toString(), { method: 'GET' });
    const hit = await cache.match(cacheKey);
    if (hit) return READ_GATE.forBrowser(hit);

    // Same lesson as the other routes: nothing stored yet, a broken record
    // and a KV error must not produce the same JSON.
    let out;
    try {
      const { record, status } = await read(env);
      out = { data: record?.data ?? null, attempt: record?.attempt ?? null, sources: { kv: status } };
    } catch (e) {
      out = { data: null, attempt: null, sources: { kv: `error: ${e.message}` } };
    }
    out.generated = new Date().toISOString();

    const res = new Response(JSON.stringify(out), {
      headers: { ...cors, 'cache-control': `public, max-age=${CACHE_SECONDS}` },
    });
    if (out.sources.kv === 'ok') await cache.put(cacheKey, res.clone());
    return READ_GATE.forBrowser(res);
  }

  return { handle };
})();

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/sports') return handleSports(request, ctx);
    if (url.pathname === '/calendar') return CALENDAR.handle(request, env);
    if (url.pathname === '/tasks') return TASKS.handle(request, env);
    if (url.pathname === '/devotion') return DEVOTION.handle(request);
    if (url.pathname === '/sitwith') return SITWITH.handle(request, env);
    if (url.pathname === '/otf') return OTF.handle(request, env);

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

      // The archive must never fail the briefing write, so every step of it
      // is guarded and its outcome only reported, in X-Sitwith-Archive.
      let previous = null, archive = "ok";
      try { previous = await env.BRIEFING.get("latest"); }
      catch (e) { archive = `error: previous latest unreadable: ${e.message}`; }

      await env.BRIEFING.put("latest", body);

      try { await SITWITH.record(env, [previous, body]); }
      catch (e) { archive = `error: ${e.message}`; }

      return new Response("OK", { headers: { ...cors, "X-Sitwith-Archive": archive } });
    }

    return new Response("Method not allowed", { status: 405, headers: cors });
  },
};