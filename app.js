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
// ESPN's public (undocumented) JSON API — no key required

async function fetchESPN(league, teamId) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${league}/scoreboard`;
  try {
    const res = await fetchRetry(url);
    const d = await res.json();
    const events = d.events || [];
    return events.filter(e =>
      e.competitions?.[0]?.competitors?.some(c => c.team?.id === String(teamId))
    );
  } catch { return []; }
}

async function fetchESPNTeamSchedule(sport, league, teamId) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/teams/${teamId}/schedule?season=2025`;
  try {
    const res = await fetch(url);
    const d = await res.json();
    return d;
  } catch { return null; }
}

function formatGameCard(game, teamLabel, abbr) {
  if (!game) return '';
  const comp = game.competitions?.[0];
  if (!comp) return '';
  const competitors = comp.competitors || [];
  const home = competitors.find(c => c.homeAway === 'home');
  const away = competitors.find(c => c.homeAway === 'away');
  if (!home || !away) return '';

  const status = comp.status?.type;
  const isLive = status?.state === 'in';
  const isFinal = status?.state === 'post';
  const isToday = status?.state === 'pre' &&
    new Date(comp.date).toDateString() === new Date().toDateString();

  const gameTime = new Date(comp.date).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true
  });

  const myTeamId = competitors.find(c =>
    c.team?.abbreviation?.toUpperCase() === abbr.toUpperCase()
  );
  const myScore = myTeamId?.score;
  const theirScore = competitors.find(c =>
    c.team?.abbreviation?.toUpperCase() !== abbr.toUpperCase()
  )?.score;

  const homeWin = isFinal && parseInt(home.score) > parseInt(away.score);
  const awayWin = isFinal && parseInt(away.score) > parseInt(home.score);

  const statusLabel = isLive
    ? `<span class="sport-time live">● LIVE · ${status.detail}</span>`
    : isFinal
    ? `<span class="sport-time">FINAL</span>`
    : isToday
    ? `<span class="sport-time tonight">TONIGHT · ${gameTime}</span>`
    : `<span class="sport-time">${shortDate(new Date(comp.date))} · ${gameTime}</span>`;

  const noteRaw = comp.notes?.[0]?.headline || comp.broadcasts?.[0]?.names?.[0] || '';
  const note = noteRaw ? `<div class="sport-note">${noteRaw}</div>` : '';

  return `
    <div class="sport-game">
      <div class="sport-meta">
        <span class="sport-league">${abbr.includes('TOT') ? 'EPL' : game.sport?.toUpperCase() || ''} · ${teamLabel}</span>
        ${statusLabel}
      </div>
      <div class="sport-teams">
        <div class="sport-team">
          <span class="sport-team-name${awayWin ? ' winner' : ''}">${away.team.displayName}</span>
          ${isFinal || isLive ? `<span class="sport-team-score${awayWin ? ' winner' : ''}">${away.score}</span>` : ''}
        </div>
        <div class="sport-team">
          <span class="sport-team-name${homeWin ? ' winner' : ''}">${home.team.displayName}</span>
          ${isFinal || isLive ? `<span class="sport-team-score${homeWin ? ' winner' : ''}">${home.score}</span>` : ''}
        </div>
      </div>
      ${note}
    </div>
  `;
}

async function loadSports() {
  const el = $('sports-content');
  if (!el) return;
  el.innerHTML = '<div class="loading">Loading scores…</div>';

  try {
    const cards = [];

    // MLB: Cubs
    const mlbCubs = await fetchESPN('baseball/mlb', '112');
    const mlbTigers = await fetchESPN('baseball/mlb', '116');
    // NFL: Lions
    const nflLions = await fetchESPN('football/nfl', '8');
    // NHL: Red Wings
    const nhlRW = await fetchESPN('hockey/nhl', '17');
    // EPL: Tottenham
    const eplSpurs = await fetchESPN('soccer/eng.1', '18');

    const cubsGame = mlbCubs[0];
    const tigersGame = mlbTigers[0];
    const lionsGame = nflLions[0];
    const rwGame = nhlRW[0];
    const spursGame = eplSpurs[0];

    if (cubsGame)  cards.push(formatGameCard(cubsGame, 'Cubs', 'CHC'));
    if (tigersGame) cards.push(formatGameCard(tigersGame, 'Tigers', 'DET'));
    if (spursGame) cards.push(formatGameCard(spursGame, 'Tottenham', 'TOT'));
    if (lionsGame) cards.push(formatGameCard(lionsGame, 'Lions', 'DET'));
    if (rwGame)    cards.push(formatGameCard(rwGame, 'Red Wings', 'DET'));

    el.innerHTML = cards.filter(Boolean).join('') ||
      '<div class="loading">No games found for your teams today.</div>';

  } catch(e) {
    el.innerHTML = '<div class="error">Scores unavailable</div>';
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

function renderCalendar() {
  const el = $('cal-content');
  const badge = $('cal-badge');
  if (!el) return;

  el.innerHTML = `
    <div class="cal-item">
      <div class="cal-time">—</div>
      <div>
        <div class="cal-title">Google Calendar not connected</div>
        <div class="cal-sub">Nothing scheduled here yet</div>
      </div>
    </div>
  `;
  if (badge) badge.textContent = '— events';
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
  renderCalendar();
}

// Cards that depend on the network. Safe to call again at any time.
function loadLiveData() {
  loadWeather();
  loadSports();
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
