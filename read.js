// ─────────────────────────────────────────────
//  read.js  — The phone reading page (read.html)
//  Loaded after config.js and shared.js. Fetching, keys and text helpers
//  live in shared.js; this file only decides what the phone shows.
//
//  Cards: masthead (date, one-line weather), reading list, devotion with
//  this week's readings, briefing. Not here on purpose: teams,
//  Orangetheory, Treasurer tasks, calendar (see DASHBOARD-REFERENCE.md,
//  The phone reading page).
// ─────────────────────────────────────────────

const UNREAD_DAYS = 14;   // unread picks older than this fall off quietly
const ARCHIVE_DAYS = 60;  // the Read section reaches back over the whole archive
const UNDO_MS = 6000;

// What the reading list knows. Re-rendered from scratch on every change.
const list = {
  data: null,          // /sitwith JSON, or null when the fetch failed
  briefing: null,      // root briefing JSON, for today's pick if the archive is down
  done: {},            // url → { status, at }
  marks: 'loading',    // ok | locked | rejected | error  (reading the marks: read key)
  marking: 'ok',       // ok | locked | rejected           (changing them: state key)
  keyForm: false,
};

// ── Masthead ───────────────────────────────────────────────────────────

const WMO = { 0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Foggy', 48: 'Icy fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 80: 'Showers', 81: 'Showers', 82: 'Heavy showers',
  95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Thunderstorm' };

function renderDate() {
  $('date').textContent = dateAtNoon(chicagoDate()).toLocaleDateString('en-US',
    { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

async function loadWeather() {
  const el = $('weather');
  const { lat, lon } = CONFIG.location;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,weathercode&daily=temperature_2m_max,temperature_2m_min` +
    `&temperature_unit=fahrenheit&timezone=America%2FChicago&forecast_days=1`;
  try {
    const d = await (await fetchRetry(url)).json();
    const t = Math.round(d.current.temperature_2m);
    const hi = Math.round(d.daily.temperature_2m_max[0]);
    const lo = Math.round(d.daily.temperature_2m_min[0]);
    el.textContent = `${t}° and ${(WMO[d.current.weathercode] || 'fair').toLowerCase()} · high ${hi}°, low ${lo}°`;
  } catch {
    el.textContent = 'Weather unavailable';
  }
}

// ── Reading list ───────────────────────────────────────────────────────

const CHECK = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

async function loadList() {
  const [data, briefing, marks] = await Promise.all([
    fetchSitwith(ARCHIVE_DAYS),
    fetchRetry(`${WORKER}/?t=${Date.now()}`).then(r => r.json()).catch(() => null),
    fetchReadingState(),
  ]);
  list.data = data;
  list.briefing = briefing;
  list.marks = marks.status;
  list.done = marks.items;
  list.marking = getStateKey() ? (list.marking === 'rejected' ? 'rejected' : 'ok') : 'locked';
  renderList();
  renderBriefing(briefing);
}

// Today's pick, the unread ones from the last two weeks, and the read ones.
function sortPicks() {
  const today = chicagoDate();
  const ok = (list.data?.sources?.archive || '').startsWith('ok');
  const items = ok ? (list.data.items || []) : [];

  // Today's pick: the archive's newest if it's today's; if the archive is
  // down, the briefing's own pick still shows.
  let todays = items[0]?.date === today && list.data.sources.latest === 'ok' ? items[0] : null;
  if (!todays && list.briefing?.date === today && list.briefing.sit_with?.url) {
    const s = list.briefing.sit_with;
    todays = { date: today, type: s.type, headline: s.headline, desc: s.desc, source: s.source, read_time: s.read_time, url: s.url };
  }

  const isDone = e => list.marks === 'ok' && !!list.done[e.url];
  const from = shiftDate(today, -(UNREAD_DAYS - 1));
  const rest = items.filter(e => e !== todays && e.url !== todays?.url);
  const unread = rest.filter(e => e.date >= from && !isDone(e));
  const read = [todays, ...rest].filter(e => e && isDone(e))
    .sort((a, b) => (list.done[b.url].at || '').localeCompare(list.done[a.url].at || ''));
  return { ok, today, todays: todays && !isDone(todays) ? todays : null, todaysDone: !!todays && isDone(todays), unread, read };
}

function pickHTML(e, { today = false, done = false } = {}) {
  const canSee = list.marks === 'ok';
  const canMark = canSee && list.marking === 'ok';
  // A weekday within the last six days; a date before that, so two weeks
  // of picks never show two "Fri"s.
  const age = (dateAtNoon(chicagoDate()) - dateAtNoon(e.date)) / 864e5;
  const when = today ? '<b>Today</b>'
    : age < 7 ? weekdayOf(e.date, 'short')
    : dateAtNoon(e.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const button = canSee ? `
    <button type="button" class="done" data-url="${escapeHTML(e.url)}"
      aria-pressed="${done}" aria-disabled="${!canMark}"
      aria-label="${done ? 'Mark as not read' : 'Mark as read'}: ${plain(e.headline)}">
      <span class="done-ring">${CHECK}</span>
    </button>` : '<span></span>';
  return `
    <article class="pick${today ? ' today' : ''}">
      <a class="pick-link" href="${safeHref(e.url)}" target="_blank" rel="noopener">
        <div class="kicker">${when} · ${plain(e.type)}</div>
        <h3 class="pick-head">${plain(e.headline)}</h3>
        ${e.desc ? `<p class="pick-desc">${plain(e.desc)}</p>` : ''}
        <div class="pick-meta">${plain(e.source)}${e.read_time ? ` · ${plain(e.read_time)}` : ''}</div>
      </a>
      ${button}
    </article>`;
}

// Why the marks or the marking are off on this device. Never silent: a
// missing key must not look like "nothing read" or a broken button.
function keylineHTML() {
  const enter = label => `<button type="button" data-keys>${label}</button>`;
  if (list.marks === 'locked') return `Read marks locked on this device · ${enter('Enter key')}`;
  if (list.marks === 'rejected') return `Read key rejected · ${enter('Re-enter key')}`;
  if (list.marks === 'error') return 'Read marks unavailable';
  if (list.marks !== 'ok') return '';
  if (list.marking === 'locked') return `Marking locked on this device · ${enter('Enter key')}`;
  if (list.marking === 'rejected') return `State key rejected · ${enter('Re-enter key')}`;
  return '';
}

function keyFormHTML() {
  const needRead = list.marks === 'locked' || list.marks === 'rejected';
  const needState = list.marking !== 'ok' || !getStateKey();
  const field = (name, label) => `
    <label>${label}<input type="password" name="${name}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>`;
  return `
    <form class="keyform" id="keyform">
      ${needRead || !needState ? field('read', 'Read key (1Password: Dashboard read key)') : ''}
      ${needState || !needRead ? field('state', 'State key (1Password: Dashboard state key)') : ''}
      <div class="keyform-row"><button type="submit" class="save">Save</button><button type="button" class="cancel" data-cancel>Cancel</button></div>
    </form>`;
}

function renderList() {
  const el = $('list');
  const { ok, todays, todaysDone, unread, read } = sortPicks();

  const line = keylineHTML();
  $('keyline').innerHTML = list.keyForm ? keyFormHTML() : (line ? `<div class="keyline">${line}</div>` : '');
  $('list-count').textContent = ok ? `${unread.length + (todays ? 1 : 0)} unread` : '';

  let html = '';
  if (todays) html += pickHTML(todays, { today: true });
  else if (!todaysDone && ok) html += `<div class="note pick-none">No pick yet this morning.</div>`;
  if (!ok) html += `<div class="error" style="padding-top:${todays ? 18 : 0}px">Archive unavailable</div>`;
  html += unread.map(e => pickHTML(e)).join('');
  if (ok && !todays && !unread.length) html += `<div class="caught-up">All caught up.</div>`;

  if (read.length) {
    const wasOpen = !!el.querySelector('.read-section[open]');
    html += `
      <details class="read-section"${wasOpen ? ' open' : ''}>
        <summary>Read · ${read.length}</summary>
        ${read.map(e => pickHTML(e, { today: e.date === chicagoDate(), done: true })).join('')}
      </details>`;
  }
  el.innerHTML = `<div class="list">${html}</div>`;
  renderFooter();
}

// ── Marking done ───────────────────────────────────────────────────────
// One change per POST, {url, done}; the Worker applies it to what's
// stored, so the phone and the iPad can't erase each other's marks. The
// row moves at once; if the Worker refuses, it moves back and says why.

let undo = null;

async function postMark(url, done) {
  const key = getStateKey();
  if (!key) return { ok: false, status: 401 };
  const send = () => fetch(`${WORKER}/reading-state`, {
    method: 'POST',
    headers: { 'X-State-Key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, done }),
  });
  try {
    let res = await send().catch(() => null);
    // One retry for a network blip or a 5xx: the change is idempotent.
    if (!res || res.status >= 500) { await new Promise(r => setTimeout(r, 1500)); res = await send(); }
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

async function setDone(url, done, { offerUndo = true } = {}) {
  const before = list.done[url];
  if (done) list.done[url] = { status: 'done', at: new Date().toISOString() };
  else delete list.done[url];
  renderList();
  if (offerUndo) showToast(done ? 'Marked read' : 'Moved back to the list', () => setDone(url, !done, { offerUndo: false }));

  const r = await postMark(url, done);
  if (r.ok) return;
  if (before) list.done[url] = before; else delete list.done[url];
  if (r.status === 401) list.marking = 'rejected';
  renderList();
  showToast(r.status === 401 ? 'State key rejected · not saved' : 'Couldn’t save · try again', null);
}

function showToast(text, onUndo) {
  const t = $('toast');
  $('toast-text').textContent = text;
  $('toast-undo').hidden = !onUndo;
  undo = onUndo;
  t.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { t.classList.remove('show'); undo = null; }, UNDO_MS);
}

$('toast-undo').addEventListener('click', () => {
  const fn = undo;
  undo = null;
  $('toast').classList.remove('show');
  if (fn) fn();
});

document.addEventListener('click', e => {
  const btn = e.target.closest('.done');
  if (btn) {
    e.preventDefault();
    if (btn.getAttribute('aria-disabled') === 'true') {
      list.keyForm = true; renderList();
      return;
    }
    setDone(btn.dataset.url, btn.getAttribute('aria-pressed') !== 'true');
    return;
  }
  if (e.target.closest('[data-keys]')) { list.keyForm = true; renderList(); focusKeyForm(); return; }
  if (e.target.closest('[data-cancel]')) { list.keyForm = false; renderList(); }
});

function focusKeyForm() {
  const input = document.querySelector('#keyform input');
  if (input) input.focus();
}

document.addEventListener('submit', e => {
  if (e.target.id !== 'keyform') return;
  e.preventDefault();
  const f = new FormData(e.target);
  const read = (f.get('read') || '').trim();
  const state = (f.get('state') || '').trim();
  if (read) setReadKey(read);
  if (state) { setStateKey(state); list.marking = 'ok'; }
  list.keyForm = false;
  loadList();
});

// ── Footer: the keys this device holds ─────────────────────────────────

function renderFooter() {
  const has = k => k ? 'saved' : 'not set';
  $('footer').innerHTML = `
    <span>This device: read key ${has(getReadKey())} · state key ${has(getStateKey())}</span>
    <button type="button" data-keys>Change keys</button>`;
}

// ── Devotion and this week's readings ──────────────────────────────────

async function loadDevotion() {
  const el = $('devotion');
  try {
    const d = await (await fetchRetry(`${WORKER}/devotion?t=${Date.now()}`)).json();
    if (d.sources?.wels !== 'ok' || !d.verse) throw new Error('not ok');
    el.innerHTML = `
      <div class="verse">${plain(d.verse)}</div>
      ${d.reference ? `<div class="verse-ref">${plain(d.reference)}</div>` : ''}
      ${d.title ? `<div class="dev-title">${plain(d.title)}</div>` : ''}
      ${d.excerpt ? `<div class="dev-excerpt">${plain(d.excerpt)}</div>` : ''}
      <div class="dev-links">
        ${d.readUrl ? `<a href="${safeHref(d.readUrl)}" target="_blank" rel="noopener">Read</a>` : ''}
        ${d.audioUrl ? `<a href="${safeHref(d.audioUrl)}" target="_blank" rel="noopener">Listen</a>` : ''}
      </div>`;
  } catch {
    el.innerHTML = `<div class="error">Devotion unavailable</div>`;
  }
}

// References only, no text and no links: the card sends Clint to his
// Bible. Any state but ok says "Readings unavailable"; no-items (the feed
// has run out) is a failure too, not a quiet week.
async function loadLectionary() {
  const el = $('lectionary');
  const title = `<div class="lect-label">This week’s readings</div>`;
  try {
    const d = await (await fetchRetry(`${WORKER}/lectionary`)).json();
    if (!(d.sources?.lectionary || '').startsWith('ok') || !d.events?.length) throw new Error('not ok');
    const today = chicagoDate();
    el.innerHTML = title + d.events.map(ev => {
      const when = ev.date === today ? 'Today'
        : dateAtNoon(ev.date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
      const rows = ev.readings.length
        ? `<dl class="lect-list">${ev.readings.map(r => `<dt>${plain(r.label)}</dt><dd>${plain(r.ref)}</dd>`).join('')}</dl>`
        : `<div class="note">No readings listed</div>`;
      return `<div class="lect-event">
          <div class="lect-when">${when}</div>
          <div class="lect-name">${plain(ev.name)}</div>
          ${rows}
        </div>`;
    }).join('');
  } catch {
    el.innerHTML = `${title}<div class="error">Readings unavailable</div>`;
  }
}

// ── Briefing ───────────────────────────────────────────────────────────
// Collapsed to the synthesis and headlines; tap a headline for its summary
// and the link. Text from the overnight run arrives HTML-encoded (an
// apostrophe as &#39;), so it's decoded, then escaped: plain() in shared.js.
// Escaping alone showed "&#39;" on the page (2026-11-01). The same goes
// for every other card's upstream text.

function renderBriefing(b) {
  const el = $('briefing');
  if (!b || !b.synthesis) {
    $('brief-count').textContent = '';
    el.innerHTML = `<div class="error">Briefing unavailable</div>`;
    return;
  }
  const stale = b.date !== chicagoDate()
    ? `<span class="stale">No briefing yet today. Showing ${plain(b.day || b.date)}’s.</span>` : '';
  const stories = b.headlines || [];
  $('brief-count').textContent = stories.length ? `${stories.length} stories` : '';
  el.innerHTML = `
    <div class="synthesis">${stale}${plain(b.synthesis)}</div>
    <div class="stories">
      ${stories.map(h => `
        <details class="story">
          <summary>
            <span class="story-cat">${plain(h.category)}</span>
            <span class="story-title">${plain(h.title)}</span>
          </summary>
          <div class="story-body">
            <div class="story-sum">${plain(h.summary)}</div>
            ${h.url ? `<a class="story-open" href="${safeHref(h.url)}" target="_blank" rel="noopener">Open story ↗</a>` : ''}
          </div>
        </details>`).join('')}
    </div>`;
}

// ── Init and refresh ───────────────────────────────────────────────────
// A home-screen app can sit open for days, so re-pull on returning to the
// foreground (60s cooldown) and on reconnecting, as the iPad page does.
// An open key form is left alone: leaving for 1Password counts as a return.

function loadAll() {
  renderDate();
  loadWeather();
  loadList();
  loadDevotion();
  loadLectionary();
}

let lastRefresh = Date.now();
function refresh() {
  if (list.keyForm) return;
  lastRefresh = Date.now();
  loadAll();
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - lastRefresh > 60 * 1000) refresh();
});
window.addEventListener('online', refresh);

renderFooter();
loadAll();
