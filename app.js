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

// Today as YYYY-MM-DD in Chicago. toISOString() is UTC, which rolls over to
// tomorrow at 7pm Central (6pm in winter).
function chicagoDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CONFIG.location?.timezone || 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

// Date-string arithmetic, anchored at UTC noon so no zone can shift the day.
const dateAtNoon = ymd => new Date(ymd + 'T12:00:00Z');
function shiftDate(ymd, days) {
  const d = dateAtNoon(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const weekdayOf = (ymd, style = 'long') =>
  dateAtNoon(ymd).toLocaleDateString('en-US', { weekday: style, timeZone: 'UTC' });

// ── Network helper ─────────────────────────────────────────────────────
// Every live card goes through this. One retry after a short pause, because
// the most common failure is a fetch firing before wifi is actually up
// (iPad waking from sleep). All of these calls are reads with no side
// effects, so retrying them is always safe.

function escapeHTML(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Some upstream text arrives entity-encoded (&#39;). Decode it to plain text
// first, then escape it for wherever it goes. A textarea parses entities
// without running or rendering anything.
const entityBox = document.createElement('textarea');
function decodeEntities(s) {
  entityBox.innerHTML = String(s ?? '');
  return entityBox.value;
}

// A failed status is thrown with `.status` on the error, so callers can tell
// "locked" (401) from "broken" (anything else).
async function fetchRetry(url, { headers, tries = 2, delayMs = 2500 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, headers ? { headers } : undefined);
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      return res;
    } catch (e) {
      lastErr = e;
      // A 401 is an answer, not a blip: asking again in 2.5s with the same
      // key gets the same answer.
      if (e.status === 401) break;
      if (i < tries - 1) await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

// ── Read key ───────────────────────────────────────────────────────────
// /calendar, /tasks and /otf need X-Read-Key. The key is entered once per device
// and kept in this browser's storage, never in the repo or this file.
// Storage can throw (private mode, blocked site data), so every access is
// guarded, and a key saved while storage is unavailable still works until
// the page closes.

const READ_KEY_STORE = 'dashReadKey';
let readKeyFallback = '';

function getReadKey() {
  try { return localStorage.getItem(READ_KEY_STORE) || readKeyFallback; }
  catch { return readKeyFallback; }
}

function setReadKey(key) {
  readKeyFallback = key;
  try { localStorage.setItem(READ_KEY_STORE, key); } catch {}
}

// One compact line in place of the card's content. `rejected` = a key is
// stored and the Worker said 401; otherwise there's no key on this device.
function renderLocked(el, badge, rejected) {
  if (badge) badge.textContent = '—';
  el.innerHTML = `
    <div class="lock-line">
      ${rejected ? 'Key rejected' : 'Locked on this device'} ·
      <button type="button" class="lock-open">${rejected ? 'Re-enter key' : 'Enter key'}</button>
    </div>`;
  el.querySelector('.lock-open').addEventListener('click', () => openKeyField(el));
}

function openKeyField(el) {
  el.innerHTML = `
    <form class="lock-form">
      <input type="password" class="lock-input" placeholder="Read key" aria-label="Read key"
             autocomplete="off" autocapitalize="off" spellcheck="false">
      <button type="submit" class="lock-save">Save</button>
    </form>`;
  const form = el.querySelector('.lock-form');
  const input = form.querySelector('.lock-input');
  input.focus();
  form.addEventListener('submit', e => {
    e.preventDefault();
    const key = input.value.trim();
    if (!key) return;
    setReadKey(key);
    reloadProtected();
  });
}

// Only the key-protected cards. Clearing them all first also closes a key
// field left open on another card.
function reloadProtected() {
  for (const id of ['cal-content', 'tasks-content', 'otf-content']) {
    const el = $(id);
    if (el) el.innerHTML = `<div class="loading">Loading…</div>`;
  }
  loadCalendar();
  loadTasks();
  loadOtf();
}

// The iPad refreshes on returning to the foreground. Leaving to copy the key
// from 1Password counts as that, so an open key field is left alone rather
// than wiped mid-entry.
const keyFieldOpen = el => !!el.querySelector('.lock-form');

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
  const leagueCap = CONFIG.sports?.maxLeague ?? 3;
  const url = CONFIG.sports?.url || 'https://briefing.clintsievers.workers.dev/sports';

  try {
    const res = await fetchRetry(url);
    const data = await res.json();

    const teams  = data.teams  || [];
    const league = data.league || [];

    // Teams first. League stories only fill what's left over, headline-only
    // so filler doesn't outweigh the teams (or outgrow the briefing column).
    const items = [...teams, ...league.slice(0, Math.min(leagueCap, Math.max(0, cap - teams.length)))]
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
        ${it.desc && it.team ? `<div class="sport-item-desc">${it.desc}</div>` : ''}
      </a>
    `).join('') + `<div class="sport-credit">via The Athletic</div>`;

  } catch (e) {
    el.innerHTML = `<div class="error">Team news unavailable</div>`;
  }
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

    // Pick 3 events using seeded random; each is clamped to 3 lines in CSS
    const rng = seededRandom(todaySeed());
    const shuffled = [...events].sort(() => rng() - 0.5);
    const picks = shuffled.slice(0, 3);

    el.innerHTML = picks.map(e => `
      <div class="otd-item">
        <span class="otd-year">${escapeHTML(e.year)}</span>
        <span class="otd-text">${escapeHTML(e.text)}</span>
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
  if (!el || keyFieldOpen(el)) return;

  const url = CONFIG.calendar?.url || 'https://briefing.clintsievers.workers.dev/calendar';
  const key = getReadKey();
  if (!key) return renderLocked(el, badge, false);

  try {
    const res = await fetchRetry(url, { headers: { 'X-Read-Key': key } });
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
    if (e.status === 401) return renderLocked(el, badge, true);
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
  if (!el || keyFieldOpen(el)) return;

  const url = CONFIG.tasks?.url || 'https://briefing.clintsievers.workers.dev/tasks';
  const key = getReadKey();
  if (!key) return renderLocked(el, badge, false);

  try {
    const res = await fetchRetry(`${url}?t=${Date.now()}`, { headers: { 'X-Read-Key': key } });
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
    // A 401 throws out of fetchRetry before the body is read, so it lands
    // here and never reaches the sources.notion check above — which would
    // call it "unavailable", since a locked reply has no notion entry.
    if (e.status === 401) return renderLocked(el, badge, true);
    // Distinct from an empty week — a failed fetch must not read as "clear".
    el.innerHTML = `<div class="error">Tasks unavailable</div>`;
    if (badge) badge.textContent = '—';
  }
}

// ── WELS daily devotion ────────────────────────────────────────────────
// Worker /devotion route. Pulls the official WELS Daily Devotions RSS feed
// (server-side — the browser can't read wels.net cross-origin) and returns
// the verse, reference, devotion title, and a short excerpt, plus read and
// listen links. Sourced, not random.

async function loadDevotion() {
  const el = $('devotion-content');
  if (!el) return;

  const url = CONFIG.devotion?.url || 'https://briefing.clintsievers.workers.dev/devotion';

  try {
    const res = await fetchRetry(`${url}?t=${Date.now()}`);
    const d = await res.json();

    // A non-ok feed must not read as a blank card — fail to an explicit state.
    if (d.sources?.wels !== 'ok' || !d.verse) {
      el.innerHTML = `<div class="error">Devotion unavailable</div>`;
      return;
    }

    el.innerHTML = `
      <div class="devotion-verse">${escapeHTML(d.verse)}</div>
      ${d.reference ? `<div class="devotion-ref">${escapeHTML(d.reference)}</div>` : ''}
      ${d.title ? `<div class="devotion-title">${escapeHTML(d.title)}</div>` : ''}
      ${d.excerpt ? `<div class="devotion-excerpt">${escapeHTML(d.excerpt)}</div>` : ''}
      <div class="devotion-links">
        ${d.readUrl ? `<a href="${escapeHTML(d.readUrl)}" target="_blank" rel="noopener">Read</a>` : ''}
        ${d.audioUrl ? `<a href="${escapeHTML(d.audioUrl)}" target="_blank" rel="noopener">Listen</a>` : ''}
      </div>`;

  } catch (e) {
    el.innerHTML = `<div class="error">Devotion unavailable</div>`;
  }
}

// ── Orangetheory ───────────────────────────────────────────────────────
// Worker /otf route, behind the read key. The otf-sync GitHub Action PUTs
// there a few times a day. The Worker keeps the last good data and the last
// attempt separately, so a failed sync shows up here as a failed sync, with
// the older numbers still visible, never as a blank or quiet card.

const OTF_ZONES = ['gray', 'blue', 'green', 'orange', 'red'];
const M_PER_MILE = 1609.344;

// "Sat 3:40am" in Chicago, from an ISO instant with an offset.
function otfWhen(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return 'an unknown time';
  const tz = CONFIG.location?.timezone || 'America/Chicago';
  const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz })
    .replace(' ', '').toLowerCase();
  return `${day}, ${time}`;
}

// "2G", "3G", "Tornado", "Strength 50", "Tread 50". The class type is the
// reliable field; 2G/3G only exists in the name.
function otfClassLabel(w) {
  const name = w.name || '';
  if (w.type === 'ORANGE_60' || w.type === 'ORANGE_90') {
    const g = name.match(/\b([23])G\b/);
    const base = g ? `${g[1]}G` : /tornado/i.test(name) ? 'Tornado' : 'Orange';
    return w.type === 'ORANGE_90' ? `90-min ${base}` : base;
  }
  if (w.type === 'STRENGTH_50') return 'Strength 50';
  if (w.type === 'TREAD_50') return 'Tread 50';
  return name || 'Class';
}

// w.start is the studio's local wall-clock time with no zone, so it's
// compared as a date string, never turned into an instant.
function otfDayLabel(start) {
  const ymd = (start || '').slice(0, 10);
  const today = chicagoDate();
  if (ymd === today) return 'Today';
  if (ymd === shiftDate(today, -1)) return 'Yesterday';
  return dateAtNoon(ymd).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

const otfFmt = (n, digits = 0) => n == null ? '—'
  : Number(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

function otfLastClassHTML(w) {
  const t = String(w.start || '').slice(11, 16);
  const [h, m] = t.split(':').map(Number);
  const time = t ? `${(h % 12) || 12}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}` : '';
  const when = `
    <div class="otf-when">
      <span class="otf-when-day">${escapeHTML(otfDayLabel(w.start))}</span>
      ${time ? `· ${time} ` : ''}· ${escapeHTML(otfClassLabel(w))}${w.coach ? ` · ${escapeHTML(w.coach)}` : ''}
    </div>`;

  // A class with nothing recorded (phone left at home, strap not paired) is
  // rare and real. Say so instead of showing zeros.
  if (!w.has_data) return `${when}<div class="otf-nodata">Attended · nothing recorded</div>`;

  const miles = w.tread?.miles, mph = w.tread?.avg_mph, meters = w.rower?.meters;
  const z = w.zones || {};
  const total = OTF_ZONES.reduce((s, k) => s + (z[k] || 0), 0);
  const zoneBar = total ? `
    <div class="otf-zones" role="img" aria-label="${OTF_ZONES.map(k => `${k} ${z[k] || 0} min`).join(', ')}">
      ${OTF_ZONES.map(k => z[k] ? `<i class="z-${k}" style="width:${(z[k] / total) * 100}%"></i>` : '').join('')}
    </div>
    <div class="otf-zone-mins">
      ${OTF_ZONES.map(k => `<span><b class="z-${k}">●</b> ${z[k] || 0}</span>`).join('')}
    </div>` : '';

  return `${when}
    <div class="otf-stats">
      <div><div class="otf-num">${otfFmt(w.splats)}</div><div class="otf-unit">splats</div></div>
      <div><div class="otf-num">${miles ? otfFmt(miles, 2) : '—'}</div>
           <div class="otf-unit">tread mi${miles && mph ? ` · ${otfFmt(mph, 1)} mph` : ''}</div></div>
      <div><div class="otf-num">${meters ? otfFmt(meters) : '—'}</div><div class="otf-unit">row m</div></div>
    </div>
    ${zoneBar}`;
}

function otfMonthHTML(month) {
  const goals = CONFIG.otf?.goals || {};
  const goal = goals[month.key] || goals.default || {};
  const name = dateAtNoon(`${month.key}-01`).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
  const row = (label, done, target, digits) => {
    const pct = target ? Math.min(100, (done / target) * 100) : 0;
    return `
      <div class="otf-goal${target && done >= target ? ' otf-goal-met' : ''}">
        <span>${label}</span>
        <span class="otf-bar"><i style="width:${pct}%"></i></span>
        <span class="otf-goal-num">${otfFmt(done, digits)}${target ? ` / ${otfFmt(target)}` : ''} mi</span>
      </div>`;
  };
  return `
    <div class="otf-month" aria-label="${escapeHTML(name)} so far">
      ${row('Tread', month.tread_miles || 0, goal.tread, 1)}
      ${row('Row', (month.rower_meters || 0) / M_PER_MILE, goal.rower, 1)}
    </div>`;
}

async function loadOtf() {
  const el = $('otf-content');
  const badge = $('otf-badge');
  if (!el || keyFieldOpen(el)) return;

  const url = CONFIG.otf?.url || 'https://briefing.clintsievers.workers.dev/otf';
  const key = getReadKey();
  if (!key) return renderLocked(el, badge, false);

  const unavailable = msg => {
    el.innerHTML = `<div class="error">${escapeHTML(msg)}</div>`;
    if (badge) badge.textContent = '—';
  };

  try {
    const res = await fetchRetry(`${url}?t=${Date.now()}`, { headers: { 'X-Read-Key': key } });
    renderOtf(await res.json());
  } catch (e) {
    if (e.status === 401) return renderLocked(el, badge, true);
    unavailable('Orangetheory unavailable');
  }

  // Split from the fetch so any state can be checked from the console:
  // renderOtf({data, attempt, sources: {kv: 'ok'}}).
  function renderOtf(d) {
    const kv = d.sources?.kv;
    if (kv === 'empty') return unavailable('No Orangetheory data yet. The first sync hasn’t run.');
    if (kv !== 'ok') return unavailable('Orangetheory unavailable');

    const { data, attempt } = d;
    const warnings = [];
    if (attempt && !attempt.ok) {
      const s = attempt.sources || {};
      const reason = (s.login || '').startsWith('failed') ? 'couldn’t log in to Orangetheory'
        : (s.workouts || '').startsWith('failed') ? 'couldn’t fetch classes' : 'failed';
      warnings.push(`<div class="otf-warn">Last sync, ${escapeHTML(otfWhen(attempt.at))}: ${reason}.${
        data ? ` Showing data from ${escapeHTML(otfWhen(data.fetched_at))}.` : ''}</div>`);
    } else if (data) {
      const ageH = (Date.now() - new Date(data.fetched_at)) / 3600000;
      if (!(ageH <= (CONFIG.otf?.staleHours || 36))) {
        warnings.push(`<div class="otf-warn">Not updated since ${escapeHTML(otfWhen(data.fetched_at))}.</div>`);
      }
    }
    // Fetched, but OTF changed something and a class didn't come through.
    const parse = attempt?.ok ? attempt.sources?.parse : null;
    if (parse && parse !== 'ok') {
      warnings.push(`<div class="otf-warn otf-warn-soft">Partial: ${escapeHTML(parse)}.</div>`);
    }

    if (!data) {
      el.innerHTML = warnings.join('') || `<div class="otf-empty">No Orangetheory data yet.</div>`;
      if (badge) badge.textContent = '—';
      return;
    }

    const last = (data.workouts || []).find(w => w.attended);
    const month = data.month || {};
    if (badge) {
      const mon = month.key
        ? dateAtNoon(`${month.key}-01`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
        : '';
      badge.textContent = month.key ? `${month.classes || 0} in ${mon}` : '—';
    }

    el.innerHTML = `
      ${warnings.join('')}
      ${last ? otfLastClassHTML(last)
        : `<div class="otf-empty">No classes in the last ${data.days || 45} days.</div>`}
      ${month.key ? otfMonthHTML(month) : ''}`;
  }
}

// ── Orangetheory workout thread ────────────────────────────────────────
// Reddit blocks programmatic reads of its JSON endpoints (search.json returns
// "blocked by network security" even from a plain browser tab), so there's no
// way to fetch the daily thread. A Worker proxy wouldn't help — the block is
// on Reddit's side, not the browser's. Sanctioned route is their OAuth API,
// which isn't worth a client secret for one link.
//
// So: a static link, at the foot of the Orangetheory card. No fetch, no
// failure mode, and it renders even when the card is locked or failing.

function renderWorkout() {
  const el = $('workout-content');
  if (!el) return;
  const sub = CONFIG.workout?.subreddit || 'orangetheory';
  el.innerHTML = `
    <a class="workout-link" href="https://www.reddit.com/r/${sub}/" target="_blank" rel="noopener">
      <div class="workout-title">Orangetheory workout thread →</div>
      <div class="workout-sub">r/${sub}</div>
    </a>`;
}

// ── Briefing + Sit With ────────────────────────────────────────────────
// The briefing-retrieval Worker PUTs today's JSON to the dashboard Worker
// overnight. The dashboard Worker serves it back publicly, with CORS headers
// so the browser can read it. No key needed to read.

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
    const isToday = briefing.date === chicagoDate();

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
      if (sitTypeEl)  sitTypeEl.textContent  = decodeEntities(s.type);
      if (sitHeadEl)  sitHeadEl.textContent  = decodeEntities(s.headline);
      if (sitDescEl)  sitDescEl.textContent  = decodeEntities(s.desc);
      if (sitMetaEl)  sitMetaEl.textContent  = decodeEntities(`${s.source} · ${s.read_time}`);
      if (sitLinkEl)  { sitLinkEl.href = s.url; sitLinkEl.textContent = 'Read it'; }
    }

  } catch (e) {
    // Graceful degradation — show config fallback for sit-with, placeholder for briefing
    if (headlinesEl) headlinesEl.innerHTML = `
      <div class="headline-item">
        <span class="headline-num">→</span>
        <span class="headline-text">No briefing yet. It's written overnight, usually by 3am.</span>
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

// ── Sit-with archive ───────────────────────────────────────────────────
// Worker /sitwith route: past picks, newest first, items[0] being the one
// in the hero card. Public, no key. Mon–Sat it fills the "Earlier this
// week" strip at the foot of the sit-with card; on Sunday it fills the
// "Last week's reads" card instead.
//
// A broken archive says so ("Archive unavailable") rather than hiding the
// strip, so it can't pass for a quiet week.

const SITWITH_URL = 'https://briefing.clintsievers.workers.dev/sitwith';

async function loadSitArchive() {
  let data = null;
  try {
    const res = await fetchRetry(`${SITWITH_URL}?days=14&t=${Date.now()}`);
    data = await res.json();
  } catch {}
  renderSitArchive(data, chicagoDate());
}

const plain = s => escapeHTML(decodeEntities(s));
const safeHref = u => /^https?:\/\//i.test(u || '') ? escapeHTML(u) : '#';

// `data` is the /sitwith JSON, or null when the fetch failed. `today` is a
// Chicago YYYY-MM-DD, passed in so a Sunday can be checked on any day.
function renderSitArchive(data, today) {
  const strip = $('sit-past');
  const card  = $('week-card');
  if (!strip || !card) return;

  const ok = (data?.sources?.archive || '').startsWith('ok');
  const items = ok ? (data.items || []) : [];
  const sunday = dateAtNoon(today).getUTCDay() === 0;

  strip.hidden = sunday;
  card.hidden = !sunday;
  return sunday ? renderLastWeek(ok, items, today) : renderEarlier(ok, items, today, data);
}

// Mon–Sat: the six days before the hero's pick, newest first, two columns.
function renderEarlier(ok, items, today, data) {
  const strip = $('sit-past');
  const label = `<div class="sit-past-label">Earlier this week</div>`;
  if (!ok) {
    strip.innerHTML = `${label}<div class="sit-past-note">Archive unavailable</div>`;
    return;
  }

  // items[0] is the hero's pick. With no pick this morning the hero shows
  // its placeholder, so count back from today instead.
  const heroDate = data.sources.latest === 'ok' && items[0] ? items[0].date : today;
  const from = shiftDate(heroDate, -6);
  const earlier = items.filter(e => e.date >= from && e.date < heroDate);

  if (!earlier.length) { strip.hidden = true; return; }

  strip.innerHTML = `${label}
    <div class="sit-past-list" style="--rows:${Math.ceil(earlier.length / 2)}">
      ${earlier.map(e => `
        <a class="sit-past-row" href="${safeHref(e.url)}" target="_blank" rel="noopener">
          <span class="sit-past-day">${weekdayOf(e.date, 'short')}</span>
          <span class="sit-past-head">${plain(e.headline)}</span>
          <span class="sit-past-src">${plain(e.source)}</span>
        </a>`).join('')}
    </div>`;
}

// Sunday: the seven days before today, Sunday through Saturday.
function renderLastWeek(ok, items, today) {
  const el = $('week-content');
  const badge = $('week-badge');
  if (!ok) {
    badge.textContent = '—';
    el.innerHTML = `<div class="error">Archive unavailable</div>`;
    return;
  }

  const from = shiftDate(today, -7);
  const week = items.filter(e => e.date >= from && e.date < today)
    .sort((a, b) => a.date.localeCompare(b.date));

  badge.textContent = `${week.length} ${week.length === 1 ? 'piece' : 'pieces'}`;
  if (!week.length) {
    el.innerHTML = `<div class="week-note">No picks recorded last week.</div>`;
    return;
  }

  el.innerHTML = `<div class="week-list">
    ${week.map(e => `
      <a class="week-item" href="${safeHref(e.url)}" target="_blank" rel="noopener">
        <div class="week-kicker"><b>${weekdayOf(e.date)}</b> · ${plain(e.type)}</div>
        <div class="week-head">${plain(e.headline)}</div>
        <div class="week-desc">${plain(e.desc)}</div>
        <div class="week-meta">${plain(e.source)} · ${plain(e.read_time)}</div>
      </a>`).join('')}
  </div>`;
}

// ── Init ───────────────────────────────────────────────────────────────

// Cards that render instantly from config.
function renderStatic() {
  renderWorkout();
}

// Cards that depend on the network. Safe to call again at any time.
function loadLiveData() {
  loadWeather();
  loadSports();
  loadCalendar();
  loadTasks();
  loadOtf();
  loadDevotion();
  loadOnThisDay();
  loadBriefing(); // handles both briefing and sit-with
  loadSitArchive();
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
  renderStatic();
  loadLiveData();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (Date.now() - lastRefresh < REFRESH_COOLDOWN) return;
  refresh();
});

window.addEventListener('online', refresh);

document.addEventListener('DOMContentLoaded', init);
