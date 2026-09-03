// ─────────────────────────────────────────────
//  app.js  — Dashboard runtime
//  Pulls live data, renders all widgets.
//  Edit config.js, not this file.
// ─────────────────────────────────────────────

// ── Utilities ──────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

function dayName(date) {
  return date.toLocaleDateString('en-US', { weekday: 'long' });
}
function fullDate(date) {
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}
function shortDate(date) {
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
function timeStr(date) {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

// Seeded random — same value for the whole day
function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}
function todaySeed() {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

// ── Network helper ─────────────────────────────────────────────────────
// Every live card goes through this. One retry after a short pause, because
// the most common failure is a fetch firing before wifi is actually up
// (iPad waking from sleep). All of these calls are reads with no side
// effects, so retrying them is always safe.

function escapeHTML(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function fetchRetry(url, tries = 2, delayMs = 2500) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

// ── Clock & Date ───────────────────────────────────────────────────────

function initClock() {
  const tick = () => {
    const now = new Date();
    const dateEl = $('topbar-date');
    const timeEl = $('topbar-time');
    if (dateEl) dateEl.textContent = fullDate(now).toUpperCase();
    if (timeEl) {
      const t = timeStr(now);
      const parts = t.split(' ');
      timeEl.innerHTML = `${parts[0]}<span>${parts[1]} CT</span>`;
    }
  };
  tick();
  setInterval(tick, 1000);
}

// ── Day Summary ────────────────────────────────────────────────────────

function renderDaySummary() {
  const el = $('day-summary');
  if (!el) return;
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 9 ? "Early start today." : hour < 12 ? "Morning." : "";
  el.innerHTML = `${greeting} The goal before noon is <strong>one outreach</strong>.`;
}

// ── Weather ────────────────────────────────────────────────────────────
// Using Open-Meteo (free, no API key, CORS-friendly)

const WMO_CODES = {
  0: "Clear", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
  45: "Foggy", 48: "Icy fog",
  51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain",
  71: "Light snow", 73: "Snow", 75: "Heavy snow",
  80: "Showers", 81: "Showers", 82: "Heavy showers",
  95: "Thunderstorm", 96: "Thunderstorm", 99: "Thunderstorm",
};

function wmoDesc(code) { return WMO_CODES[code] || "—"; }

async function loadWeather() {
  const el = $('weather-content');
  const { lat, lon } = CONFIG.location;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,apparent_temperature,weathercode,windspeed_10m,winddirection_10m` +
    `&hourly=temperature_2m,precipitation_probability,weathercode` +
    `&daily=temperature_2m_max,temperature_2m_min,weathercode,sunrise,sunset` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America%2FChicago` +
    `&forecast_days=7`;

  try {
    const res = await fetchRetry(url);
    const d = await res.json();
    const c = d.current;
    const daily = d.daily;
    const hourly = d.hourly;

    const temp = Math.round(c.temperature_2m);
    const feel = Math.round(c.apparent_temperature);
    const desc = wmoDesc(c.weathercode);
    const wind = Math.round(c.windspeed_10m);
    const hiToday = Math.round(daily.temperature_2m_max[0]);
    const loToday = Math.round(daily.temperature_2m_min[0]);
    const sunset = new Date(daily.sunset[0]).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

    // Hourly — next 8 hours
    const nowHour = new Date().getHours();
    const hourSlices = [];
    for (let i = 0; i < hourly.time.length; i++) {
      const h = new Date(hourly.time[i]).getHours();
      if (h >= nowHour && hourSlices.length < 8) {
        hourSlices.push({
          time: new Date(hourly.time[i]).toLocaleTimeString('en-US', { hour: 'numeric' }),
          temp: Math.round(hourly.temperature_2m[i]),
          rain: hourly.precipitation_probability[i],
        });
      }
    }

    // 7-day forecast
    const days = ['Su','Mo','Tu','We','Th','Fr','Sa'];
    const forecastDays = daily.time.slice(1, 6).map((t, i) => ({
      name: days[new Date(t + 'T12:00:00').getDay()],
      hi: Math.round(daily.temperature_2m_max[i + 1]),
      lo: Math.round(daily.temperature_2m_min[i + 1]),
    }));

    // Update AQI badge (static Good for now — Air Quality API in Phase 2)
    const aqiBadge = $('weather-aqi-badge');
    if (aqiBadge) aqiBadge.textContent = 'AQI —';

    el.innerHTML = `
      <div class="weather-main">
        <div class="weather-temp">${temp}<sup>°</sup></div>
        <div class="weather-meta">
          <div class="weather-desc">${desc}</div>
          <div class="weather-sub">
            Feels ${feel}° · H ${hiToday}° L ${loToday}°<br>
            ${wind} mph · ↓ ${sunset}
          </div>
        </div>
      </div>
      <div class="weather-hourly">
        ${hourSlices.map(h => `
          <div class="weather-hour">
            <div class="weather-hour-time">${h.time.replace(' AM','a').replace(' PM','p')}</div>
            <div class="weather-hour-temp">${h.temp}°</div>
            ${h.rain > 20 ? `<div class="weather-hour-rain">${h.rain}%</div>` : '<div class="weather-hour-rain" style="color:transparent">·</div>'}
          </div>
        `).join('')}
      </div>
      <div class="weather-forecast">
        ${forecastDays.map(d => `
          <div class="forecast-day">
            <div class="forecast-day-name">${d.name}</div>
            <div class="forecast-day-hi">${d.hi}°</div>
            <div class="forecast-day-lo">${d.lo}°</div>
          </div>
        `).join('')}
      </div>
    `;
  } catch (e) {
    el.innerHTML = `<div class="error">Weather unavailable</div>`;
  }
}

// ── Sports ─────────────────────────────────────────────────────────────
// Team news from The Athletic's league RSS feeds, filtered and cached by the
// Worker. Scores deliberately not shown — ESPN does that better and it wasn't
// the thing worth opening an app for.
//
// The cap is the whole point of this card. Six items that end beats twenty
// that don't; if it never runs out, it's a feed and we're back to scrolling.

async function loadSports() {
  const el = $('sports-content');
  const badge = $('sports-teams-badge');
  if (!el) return;

  const cap = CONFIG.sports?.maxItems ?? 6;
  const url = CONFIG.sports?.url || 'https://briefing.clintsievers.workers.dev/sports';

  try {
    const res = await fetchRetry(url);
    const data = await res.json();

    const teams  = data.teams  || [];
    const league = data.league || [];

    // Teams first. League stories only fill what's left over.
    const items = [...teams, ...league.slice(0, Math.max(0, cap - teams.length))]
      .slice(0, cap);

    if (!items.length) {
      el.innerHTML = `<div class="sport-empty">Nothing on your teams today.</div>`;
      if (badge) badge.textContent = 'clear';
      return;
    }

    if (badge) {
      const n = teams.length;
      badge.textContent = n ? `${n} on your teams` : 'league only';
    }

    el.innerHTML = items.map(it => `
      <a class="sport-item" href="${it.url}" target="_blank" rel="noopener">
        <div class="sport-item-tag">${it.team || it.league}</div>
        <div class="sport-item-title">${it.title}</div>
        ${it.desc ? `<div class="sport-item-desc">${it.desc}</div>` : ''}
      </a>
    `).join('') + `<div class="sport-credit">via The Athletic</div>`;

  } catch (e) {
    el.innerHTML = `<div class="error">Team news unavailable</div>`;
  }
}

// ── Journal ────────────────────────────────────────────────────────────

function renderJournal() {
  const promptEl = $('journal-prompt');
  const streakEl = $('journal-streak');
  const windowEl = $('journal-window');
  if (!promptEl) return;

  const { journalPrompts, journalStreak, journalWindowCloses } = CONFIG;

  // Pick prompt by day of year (consistent across sessions)
  const doy = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  const prompt = journalPrompts[doy % journalPrompts.length];

  if (promptEl) promptEl.textContent = `"${prompt}"`;
  if (streakEl) streakEl.textContent = journalStreak;

  // Window closes message
  if (windowEl) {
    const [hh, mm] = journalWindowCloses.split(':').map(Number);
    const now = new Date();
    const closes = new Date();
    closes.setHours(hh, mm, 0, 0);
    const minsLeft = Math.round((closes - now) / 60000);

    if (minsLeft > 0 && minsLeft < 120) {
      windowEl.innerHTML = `Window closes in <span class="closes">${minsLeft} min</span>. Three sentences.`;
    } else if (minsLeft <= 0) {
      windowEl.textContent = 'Journal window closed. Pick it up tomorrow.';
    } else {
      windowEl.innerHTML = `Window closes at <span class="closes">${journalWindowCloses.replace(':','h').replace(/^0/,'')}</span>. Three sentences.`;
    }
  }
}

// ── Something to Sit With ──────────────────────────────────────────────

function renderSitWith() {
  const { sitWith } = CONFIG;
  const typeEl = $('sit-type');
  const headlineEl = $('sit-headline');
  const descEl = $('sit-desc');
  const metaEl = $('sit-meta');
  const linkEl = $('sit-link');

  if (typeEl) typeEl.textContent = sitWith.type;
  if (headlineEl) headlineEl.textContent = sitWith.headline;
  if (descEl) descEl.textContent = sitWith.desc;
  if (metaEl) metaEl.textContent = `${sitWith.source} · ${sitWith.readTime}`;
  if (linkEl) { linkEl.href = sitWith.url; linkEl.textContent = 'Read it'; }
}

// ── Slow Burns ─────────────────────────────────────────────────────────

function renderSlowBurns() {
  const el = $('burn-content');
  if (!el) return;

  const { slowBurns, slowBurnOverdue } = CONFIG;

  // Sort: most overdue first
  const sorted = [...slowBurns].sort((a, b) => b.lastTouched - a.lastTouched);

  el.innerHTML = sorted.map(b => {
    const isOverdue = b.lastTouched >= slowBurnOverdue;
    const pct = Math.min(100, Math.round((b.lastTouched / (slowBurnOverdue * 2)) * 100));
    return `
      <div class="burn-item">
        <div class="burn-name">${b.name}</div>
        <div class="burn-bar"><div class="burn-fill" style="width:${pct}%"></div></div>
        <div class="burn-age ${isOverdue ? 'overdue' : ''}">${b.lastTouched}d</div>
      </div>
    `;
  }).join('');
}

// ── On This Day ────────────────────────────────────────────────────────
// Uses Wikipedia's "On this day" API

async function loadOnThisDay() {
  const el = $('otd-content');
  if (!el) return;

  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();

  try {
    const url = `https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/${month}/${day}`;
    const res = await fetchRetry(url);
    const d = await res.json();
    const events = d.events || [];

    // Pick 4 interesting events using seeded random
    const rng = seededRandom(todaySeed());
    const shuffled = [...events].sort(() => rng() - 0.5);
    const picks = shuffled.slice(0, 4);

    el.innerHTML = picks.map(e => `
      <div class="otd-item">
        <span class="otd-year">${e.year}</span>
        <span>${e.text}</span>
      </div>
    `).join('');
  } catch {
    el.innerHTML = '<div class="error">Unavailable today</div>';
  }
}

// ── Calendar Scaffold ──────────────────────────────────────────────────
// Phase 2: wire to Google Calendar API
// For now: placeholder with instructions

// ── Calendar ───────────────────────────────────────────────────────────
// Worker /calendar route. The Worker holds the secret .ics URL and does the
// recurrence expansion, because the browser can neither hold a secret nor
// fetch calendar.google.com cross-origin.

// Calendar locations are often a bare meeting URL. Rendering that as text
// puts 90 characters of query string in a card five columns wide, so link
// it and label it by host instead. Anything that is not an http(s) URL is
// a real place and gets shown as written.
function locationHTML(loc) {
  let u;
  try { u = new URL(loc); } catch { return escapeHTML(loc); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return escapeHTML(loc);

  const host = u.hostname.replace(/^www\./, '');
  const known = { 'zoom.us': 'Zoom', 'meet.google.com': 'Meet',
                  'teams.microsoft.com': 'Teams', 'teams.live.com': 'Teams' };
  const label = Object.keys(known).find(k => host === k || host.endsWith('.' + k));

  return `<a class="cal-link" href="${escapeHTML(u.href)}" target="_blank" rel="noopener">`
       + `${escapeHTML(label ? known[label] : host)} \u2197</a>`;
}

async function loadCalendar() {
  const el = $('cal-content');
  const badge = $('cal-badge');
  if (!el) return;

  const url = CONFIG.calendar?.url || 'https://briefing.clintsievers.workers.dev/calendar';

  try {
    const res = await fetchRetry(url);
    const data = await res.json();
    const events = data.events || [];

    if (!events.length) {
      el.innerHTML = `<div class="cal-empty">Nothing on the calendar today.</div>`;
      if (badge) badge.textContent = 'clear';
      return;
    }

    if (badge) badge.textContent = `${events.length} ${events.length === 1 ? 'event' : 'events'}`;

    const now = Date.now();

    el.innerHTML = events.map(ev => {
      const start = ev.start ? new Date(ev.start) : null;
      const end   = ev.end   ? new Date(ev.end)   : null;

      const isNow = start && end && now >= start.getTime() && now < end.getTime();
      const isPast = end ? now >= end.getTime() : (start ? now >= start.getTime() : false);

      const time = ev.allDay
        ? 'all day'
        : start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
            .replace(' AM', 'a').replace(' PM', 'p');

      return `
        <div class="cal-item${isNow ? ' now' : ''}"${isPast && !isNow ? ' style="opacity:0.45"' : ''}>
          <div class="cal-time${isNow ? ' now-time' : ''}">${time}</div>
          <div>
            <div class="cal-title">${escapeHTML(ev.title)}${isNow ? '<span class="now-pill">now</span>' : ''}</div>
            ${ev.location ? `<div class="cal-sub">${locationHTML(ev.location)}</div>` : ''}
          </div>
        </div>
      `;
    }).join('');

  } catch (e) {
    // An error state has to be visually distinct from an empty day, or a
    // failed fetch reads as a free morning.
    el.innerHTML = `<div class="error">Calendar unavailable</div>`;
    if (badge) badge.textContent = '—';
  }
}

// ── JELC treasurer tasks ───────────────────────────────────────────────
// Worker /tasks route. The Worker holds NOTION_TOKEN and does the querying,
// because the browser can neither hold the token nor fetch api.notion.com
// cross-origin. Two sections: what's due (overdue + next 7 days) and what
// was recently settled (due in the last 7 days and now Paid/Complete).

function tasksDueLabel(t) {
  if (t.overdue)          return `${Math.abs(t.daysUntil)}d overdue`;
  if (t.daysUntil === 0)  return 'due today';
  if (t.daysUntil === 1)  return 'due tomorrow';
  if (t.daysUntil == null) return '';
  return `in ${t.daysUntil}d`;
}

async function loadTasks() {
  const el = $('tasks-content');
  const badge = $('tasks-badge');
  if (!el) return;

  const url = CONFIG.tasks?.url || 'https://briefing.clintsievers.workers.dev/tasks';

  try {
    const res = await fetchRetry(`${url}?t=${Date.now()}`);
    const data = await res.json();

    // A non-ok sources block means the token expired or the integration lost
    // access — that must NOT look like a quiet week. Fail loudly instead.
    const notionOk = (data.sources?.notion || '').startsWith('ok');
    if (!notionOk) {
      el.innerHTML = `<div class="error">Tasks unavailable</div>`;
      if (badge) badge.textContent = '—';
      return;
    }

    const due = data.due || [];
    const done = data.done || [];
    const overdue = data.counts?.overdue || 0;

    if (badge) {
      badge.textContent = due.length
        ? (overdue ? `${overdue} overdue` : `${due.length} due`)
        : 'clear';
    }

    if (!due.length && !done.length) {
      el.innerHTML = `<div class="tasks-empty">Nothing due in the next 7 days.</div>`;
      return;
    }

    const dueRows = due.map(t => `
      <a class="task-row${t.overdue ? ' task-overdue' : ''}" href="${escapeHTML(t.url || '#')}" target="_blank" rel="noopener">
        <div class="task-main">
          <div class="task-title">${escapeHTML(t.title || 'Untitled')}</div>
          ${t.category ? `<div class="task-cat">${escapeHTML(t.category)}</div>` : ''}
        </div>
        <div class="task-due${t.overdue ? ' task-due-over' : ''}">${escapeHTML(tasksDueLabel(t))}</div>
      </a>`).join('');

    const doneRows = done.map(t => `
      <a class="task-row task-done" href="${escapeHTML(t.url || '#')}" target="_blank" rel="noopener">
        <div class="task-main">
          <div class="task-title">${escapeHTML(t.title || 'Untitled')}</div>
          ${t.category ? `<div class="task-cat">${escapeHTML(t.category)}</div>` : ''}
        </div>
        <div class="task-settled">${escapeHTML(t.status || 'Done')}</div>
      </a>`).join('');

    el.innerHTML = `
      <div class="tasks-col">
        <div class="tasks-subhead">Due</div>
        ${due.length ? dueRows : `<div class="tasks-empty">Nothing due.</div>`}
      </div>
      <div class="tasks-col">
        <div class="tasks-subhead">Recently settled</div>
        ${done.length ? doneRows : `<div class="tasks-empty">Nothing settled this week.</div>`}
      </div>`;

  } catch (e) {
    // Distinct from an empty week — a failed fetch must not read as "clear".
    el.innerHTML = `<div class="error">Tasks unavailable</div>`;
    if (badge) badge.textContent = '—';
  }
}

// ── Orangetheory daily workout ─────────────────────────────────────────
// Reddit blocks programmatic reads of its JSON endpoints (search.json returns
// "blocked by network security" even from a plain browser tab), so there's no
// way to fetch the daily thread. A Worker proxy wouldn't help — the block is
// on Reddit's side, not the browser's. Sanctioned route is their OAuth API,
// which isn't worth a client secret for one link.
//
// So: a static link. No fetch, no failure mode. It can't tell you whether the
// thread is up, but it saves the hunt for it.

function renderWorkout() {
  const el = $('workout-content');
  if (!el) return;
  const sub = CONFIG.workout?.subreddit || 'orangetheory';
  el.innerHTML = `
    <a class="workout-link" href="https://www.reddit.com/r/${sub}/" target="_blank" rel="noopener">
      <div class="workout-title">Today's workout thread</div>
      <div class="workout-sub">r/${sub}</div>
    </a>`;
}

// ── Briefing + Sit With — live from Notion ─────────────────────────────
// The briefing skill PUTs today's JSON to a Cloudflare Worker each morning.
// The Worker serves it back publicly, with CORS headers so the browser can read it.
// No key needed to read; the write key lives only in the briefing skill.

const BRIEFING_URL = 'https://briefing.clintsievers.workers.dev/';

async function loadBriefing() {
  const headlinesEl = $('briefing-headlines');
  const synthesisEl = document.querySelector('.briefing-summary');
  const sitTypeEl   = $('sit-type');
  const sitHeadEl   = $('sit-headline');
  const sitDescEl   = $('sit-desc');
  const sitMetaEl   = $('sit-meta');
  const sitLinkEl   = $('sit-link');

  try {
    // Add cache-busting so the browser doesn't serve yesterday's file
    const res = await fetchRetry(`${BRIEFING_URL}?t=${Date.now()}`);

    const briefing = await res.json();
    const today = new Date().toISOString().split('T')[0];
    const isToday = briefing.date === today;

    // ── Synthesis ──
    if (synthesisEl) {
      synthesisEl.innerHTML = isToday
        ? `<span class="briefing-lede">${briefing.synthesis}</span>`
        : `<span style="color:var(--ink-4);font-style:italic">No briefing yet today. Showing ${briefing.day}'s.</span> ${briefing.synthesis}`;
    }

    // ── Headlines ──
    if (headlinesEl && briefing.headlines?.length) {
      headlinesEl.innerHTML = briefing.headlines.map(h => `
        <div class="headline-item" onclick="window.open('${h.url}','_blank')">
          <span class="headline-cat">${h.category}</span>
          <span class="headline-text">
            <strong>${h.title}</strong><br>
            <span class="headline-sum">${h.summary}</span>
          </span>
        </div>
      `).join('');
      const countEl = $('briefing-count');
      if (countEl) countEl.textContent = `${briefing.headlines.length} stories`;
    }

    // ── Something to sit with ──
    const s = briefing.sit_with;
    if (s) {
      if (sitTypeEl)  sitTypeEl.textContent  = s.type;
      if (sitHeadEl)  sitHeadEl.textContent  = s.headline;
      if (sitDescEl)  sitDescEl.textContent  = s.desc;
      if (sitMetaEl)  sitMetaEl.textContent  = `${s.source} · ${s.read_time}`;
      if (sitLinkEl)  { sitLinkEl.href = s.url; sitLinkEl.textContent = 'Read it'; }
    }

  } catch (e) {
    // Graceful degradation — show config fallback for sit-with, placeholder for briefing
    if (headlinesEl) headlinesEl.innerHTML = `
      <div class="headline-item">
        <span class="headline-num">→</span>
        <span class="headline-text">No briefing yet today. It lands at 6am on weekdays.</span>
      </div>`;

    // Fall back to config for sit-with
    if (CONFIG.sitWith) {
      const s = CONFIG.sitWith;
      if (sitTypeEl)  sitTypeEl.textContent  = s.type;
      if (sitHeadEl)  sitHeadEl.textContent  = s.headline;
      if (sitDescEl)  sitDescEl.textContent  = s.desc;
      if (sitMetaEl)  sitMetaEl.textContent  = `${s.source} · ${s.readTime}`;
      if (sitLinkEl)  { sitLinkEl.href = s.url; sitLinkEl.textContent = 'Read it'; }
    }
  }
}

// ── Init ───────────────────────────────────────────────────────────────

// Cards that render instantly from config or the clock.
function renderStatic() {
  renderDaySummary();
  renderJournal();
  renderSlowBurns();
  renderWorkout();
}

// Cards that depend on the network. Safe to call again at any time.
function loadLiveData() {
  loadWeather();
  loadSports();
  loadCalendar();
  loadTasks();
  loadOnThisDay();
  loadBriefing(); // handles both briefing and sit-with
}

function init() {
  initClock();
  renderStatic();
  loadLiveData();
}

// ── Refresh on return ──────────────────────────────────────────────────
// The dashboard lives as a standalone app on the iPad, so a single page load
// can sit open for days. Without this, a fetch that failed at 6am stays
// failed until a manual reload. Re-pull whenever the app comes back to the
// foreground, or when the device reconnects.

let lastRefresh = Date.now();
const REFRESH_COOLDOWN = 60 * 1000; // don't re-pull on quick app switches

function refresh() {
  lastRefresh = Date.now();
  renderStatic();  // time-sensitive text (journal window, greeting)
  loadLiveData();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (Date.now() - lastRefresh < REFRESH_COOLDOWN) return;
  refresh();
});

window.addEventListener('online', refresh);

document.addEventListener('DOMContentLoaded', init);
