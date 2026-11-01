// ─────────────────────────────────────────────
//  shared.js  — Code both pages use
//  Loaded by index.html (the iPad) and read.html (the phone) before their
//  own script. Plain script, no build step.
//
//  Why it exists: two pages rendering the same data drift apart. So the
//  fetching, decoding and keys live here, once, and only the rendering
//  differs (app.js for the iPad, read.js for the phone).
// ─────────────────────────────────────────────

const $ = id => document.getElementById(id);

// The briefing Worker (dashboard-worker/). Every route below hangs off it.
const WORKER = 'https://briefing.clintsievers.workers.dev';

// ── Dates ──────────────────────────────────────────────────────────────

// Today as YYYY-MM-DD in Chicago. toISOString() is UTC, which rolls over to
// tomorrow at 7pm Central (6pm in winter).
function chicagoDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: (typeof CONFIG !== 'undefined' && CONFIG.location?.timezone) || 'America/Chicago',
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

// ── Text ───────────────────────────────────────────────────────────────

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

const plain = s => escapeHTML(decodeEntities(s));
const safeHref = u => /^https?:\/\//i.test(u || '') ? escapeHTML(u) : '#';

// ── Network helper ─────────────────────────────────────────────────────
// Every live card goes through this. One retry after a short pause, because
// the most common failure is a fetch firing before wifi is actually up
// (iPad waking from sleep). All of these calls are reads with no side
// effects, so retrying them is always safe.
//
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

// ── Keys ───────────────────────────────────────────────────────────────
// Two keys, each entered once per device and kept in this browser's
// storage, never in the repo or this file. Each does one job:
//   read key   X-Read-Key    /calendar, /tasks, /otf, GET /reading-state
//   state key  X-State-Key   POST /reading-state (marking a pick done)
// Storage can throw (private mode, blocked site data), so every access is
// guarded, and a key saved while storage is unavailable still works until
// the page closes.

const READ_KEY_STORE = 'dashReadKey';
const STATE_KEY_STORE = 'dashStateKey';
const keyFallback = {};

function getStoredKey(name) {
  try { return localStorage.getItem(name) || keyFallback[name] || ''; }
  catch { return keyFallback[name] || ''; }
}

function setStoredKey(name, key) {
  keyFallback[name] = key;
  try { localStorage.setItem(name, key); } catch {}
}

const getReadKey = () => getStoredKey(READ_KEY_STORE);
const setReadKey = key => setStoredKey(READ_KEY_STORE, key);
const getStateKey = () => getStoredKey(STATE_KEY_STORE);
const setStateKey = key => setStoredKey(STATE_KEY_STORE, key);

// ── Sit-with archive ───────────────────────────────────────────────────
// Worker /sitwith: past picks, newest first, items[0] being today's (the
// hero card's). Public, no key. Returns the JSON, or null when the fetch
// failed. A caller checks sources.archive, so a broken archive can't pass
// for a quiet week.

const SITWITH_URL = `${WORKER}/sitwith`;

async function fetchSitwith(days = 14) {
  try {
    const res = await fetchRetry(`${SITWITH_URL}?days=${days}&t=${Date.now()}`);
    return await res.json();
  } catch {
    return null;
  }
}

// ── Reading state ──────────────────────────────────────────────────────
// Worker /reading-state: which picks are marked done, shared by both pages.
// Reading needs the read key. Returns { status, items }, where status is
//   ok        items is { url: { status: 'done', at } }
//   locked    no read key on this device
//   rejected  the Worker refused the key (401)
//   error     anything else, including an unreadable record
// so a missing key never looks like "nothing marked".

async function fetchReadingState() {
  const key = getReadKey();
  if (!key) return { status: 'locked', items: {} };
  try {
    const res = await fetchRetry(`${WORKER}/reading-state?t=${Date.now()}`, { headers: { 'X-Read-Key': key } });
    const data = await res.json();
    const kv = data.sources?.kv;
    if (kv !== 'ok' && kv !== 'empty') return { status: 'error', items: {} };
    return { status: 'ok', items: data.items || {} };
  } catch (e) {
    return { status: e.status === 401 ? 'rejected' : 'error', items: {} };
  }
}
