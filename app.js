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
  // Build dynamically; calendar data will enhance this in Phase 2
  el.innerHTML = `${greeting} Check your calendar for today's commitments. Job search pipeline is live below — <strong>one outreach</strong> is the goal before noon.`;
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
    const res = await fetch(url);
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
    const res = await fetch(url);
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

// ── NYT Games ──────────────────────────────────────────────────────────
// Done-state lives in localStorage keyed by today's date string.
// Clicking a tile toggles done (without navigating); Shift+click opens the game.
// Resets automatically when the date changes.

function gamesStorageKey() {
  const d = new Date();
  return `games-done-${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
}

function loadGamesDone() {
  try {
    const raw = localStorage.getItem(gamesStorageKey());
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveGamesDone(done) {
  try { localStorage.setItem(gamesStorageKey(), JSON.stringify(done)); } catch {}
}

function renderGames() {
  const { streak, games } = CONFIG.games;
  const grid = $('games-grid');
  const streakEl = $('streak-num');
  const badge = $('streak-badge');
  if (!grid) return;

  const done = loadGamesDone();

  const updateBadge = () => {
    const d = loadGamesDone();
    const count = games.filter(g => d[g.abbr]).length;
    if (badge) badge.textContent = `${count}/${games.length} done today`;
  };

  grid.innerHTML = games.map(g => `
    <div class="game-tile${done[g.abbr] ? ' done' : ''}"
         data-abbr="${g.abbr}" data-url="${g.url}"
         title="Click to mark done · Shift+click to open game">
      <div class="game-abbr">${g.abbr}</div>
      <div class="game-name">${g.name}</div>
      <div class="game-status ${done[g.abbr] ? 'done' : 'play'}" id="game-status-${g.abbr}">
        ${done[g.abbr] ? '✓ Done' : '● Play'}
      </div>
    </div>
  `).join('');

  // Click handler: shift+click opens, plain click toggles done
  grid.querySelectorAll('.game-tile').forEach(tile => {
    tile.addEventListener('click', e => {
      if (e.shiftKey) {
        window.open(tile.dataset.url, '_blank');
        return;
      }
      const abbr = tile.dataset.abbr;
      const d = loadGamesDone();
      d[abbr] = !d[abbr];
      saveGamesDone(d);
      tile.classList.toggle('done', !!d[abbr]);
      const statusEl = tile.querySelector('.game-status');
      if (statusEl) {
        statusEl.className = `game-status ${d[abbr] ? 'done' : 'play'}`;
        statusEl.textContent = d[abbr] ? '✓ Done' : '● Play';
      }
      updateBadge();
    });
    tile.style.cursor = 'pointer';
  });

  if (streakEl) streakEl.textContent = streak;
  updateBadge();
}

// ── JELS Expansion ─────────────────────────────────────────────────────

function renderJELS() {
  const el = $('jels-content');
  const badge = $('jels-countdown-badge');
  if (!el) return;

  const { groundbreakingDate, openingDate, campaignGoal, campaignRaised, reserveTarget, reserveCurrent } = CONFIG.jels;

  const now = new Date();
  const groundbreaking = new Date(groundbreakingDate);
  const opening = new Date(openingDate);

  const daysToGroundbreaking = Math.ceil((groundbreaking - now) / (1000 * 60 * 60 * 24));
  const daysToOpening = Math.ceil((opening - now) / (1000 * 60 * 60 * 24));

  const campaignPct = Math.min(100, Math.round((campaignRaised / campaignGoal) * 100));
  const reservePct  = Math.min(100, Math.round((reserveCurrent / reserveTarget) * 100));

  if (badge) badge.textContent = `${daysToGroundbreaking}d to groundbreaking`;

  el.innerHTML = `
    <div class="jels-stat">
      <div class="jels-stat-label">Groundbreaking</div>
      <div class="jels-stat-value">${daysToGroundbreaking.toLocaleString()}<small style="font-size:14px;color:var(--ink-3)"> days</small></div>
      <div class="jels-stat-sub">Target: ${groundbreaking.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</div>
    </div>
    <div class="jels-stat">
      <div class="jels-stat-label">Campaign raised</div>
      <div class="jels-stat-value">$${campaignRaised.toLocaleString()}</div>
      <div class="jels-stat-sub">of $${campaignGoal.toLocaleString()} goal · ${campaignPct}%</div>
      <div class="jels-progress"><div class="jels-progress-bar" style="width:${campaignPct}%"></div></div>
    </div>
    <div class="jels-stat">
      <div class="jels-stat-label">Pre-construction reserves</div>
      <div class="jels-stat-value">$${reserveCurrent.toLocaleString()}</div>
      <div class="jels-stat-sub">of $${reserveTarget.toLocaleString()} target · ${reservePct}%</div>
      <div class="jels-progress"><div class="jels-progress-bar" style="width:${reservePct}%"></div></div>
    </div>
  `;
}

// ── Job Search Pipeline ─────────────────────────────────────────────────
// Last-contact dates stored in localStorage as ISO date strings, keyed by org name.
// "Touched today" button sets today's date. Days-ago calculated fresh each load.

function pipelineStorageKey() { return 'pipeline-contacts'; }

function loadContacts() {
  try {
    const raw = localStorage.getItem(pipelineStorageKey());
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveContact(org) {
  const contacts = loadContacts();
  contacts[org] = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  try { localStorage.setItem(pipelineStorageKey(), JSON.stringify(contacts)); } catch {}
}

function daysAgo(isoDate) {
  if (!isoDate) return null;
  const then = new Date(isoDate);
  const now = new Date();
  // Compare calendar dates only
  const thenDate = new Date(then.getFullYear(), then.getMonth(), then.getDate());
  const nowDate  = new Date(now.getFullYear(),  now.getMonth(),  now.getDate());
  return Math.round((nowDate - thenDate) / 86400000);
}

function renderPipeline() {
  const el = $('pipeline-content');
  const nudgeEl = $('pipeline-nudge');
  const badge = $('pipeline-badge');
  if (!el) return;

  const { pipeline, pipelineNudgeAfter } = CONFIG;
  const contacts = loadContacts();

  if (badge) badge.textContent = `${pipeline.filter(p => p.status === 'hot').length} hot`;

  el.innerHTML = pipeline.map(p => {
    const days = daysAgo(contacts[p.org]);
    const ageLabel = days === null ? 'never' : days === 0 ? 'today' : `${days}d ago`;
    const isStale = days === null || days >= pipelineNudgeAfter;
    return `
      <div class="pipeline-item">
        <div class="pipeline-dot ${p.status}"></div>
        <div class="pipeline-org">${p.org}</div>
        <div class="pipeline-stage">${p.stage}</div>
        <button class="pipeline-touch" data-org="${p.org}" title="Mark as contacted today">✓</button>
        <div class="pipeline-age ${isStale && days !== 0 ? 'stale' : ''}">${ageLabel}</div>
      </div>
    `;
  }).join('');

  // Touch buttons
  el.querySelectorAll('.pipeline-touch').forEach(btn => {
    btn.addEventListener('click', () => {
      const org = btn.dataset.org;
      saveContact(org);
      renderPipeline(); // re-render to update ages
    });
  });

  // Nudge for anything stale
  const stale = pipeline.filter(p => {
    const days = daysAgo(contacts[p.org]);
    return days === null || days >= pipelineNudgeAfter;
  });
  if (stale.length > 0 && nudgeEl) {
    nudgeEl.style.display = 'block';
    nudgeEl.textContent = `${stale.map(p => p.org).join(', ')} ${stale.length === 1 ? 'has' : 'have'} gone quiet — worth a touch today?`;
  } else if (nudgeEl) {
    nudgeEl.style.display = 'none';
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
  if (linkEl) { linkEl.href = sitWith.url; linkEl.textContent = 'Read →'; }
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
    const res = await fetch(url);
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
        <div class="cal-title">Google Calendar in Phase 2</div>
        <div class="cal-sub">Add your client ID to config.js to enable live events</div>
      </div>
    </div>
  `;
  if (badge) badge.textContent = '— events';
}

// ── Briefing Scaffold ──────────────────────────────────────────────────
// Phase 2: pull from Gmail or a Notion summary page

function renderBriefing() {
  const el = $('briefing-headlines');
  if (!el) return;

  // Placeholder until cloud-scheduled briefing is wired
  el.innerHTML = `
    <div class="headline-item">
      <span class="headline-num">→</span>
      <span class="headline-text">Your briefing runs via Cowork — Phase 2 will surface today's headlines here automatically.</span>
    </div>
    <div class="headline-item">
      <span class="headline-num">→</span>
      <span class="headline-text">Once cloud-scheduled, the briefing summary will appear here each morning before you open this dashboard.</span>
    </div>
  `;
}

// ── Init ───────────────────────────────────────────────────────────────

function init() {
  initClock();
  renderDaySummary();
  renderGames();
  renderJELS();
  renderPipeline();
  renderJournal();
  renderSitWith();
  renderSlowBurns();
  renderCalendar();
  renderBriefing();

  // Async / network-dependent
  loadWeather();
  loadSports();
  loadOnThisDay();
}

document.addEventListener('DOMContentLoaded', init);
