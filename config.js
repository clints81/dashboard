// ─────────────────────────────────────────────
//  config.js  — Your personal data layer
//  Edit this file to update the dashboard.
//  No coding required for anything in here.
// ─────────────────────────────────────────────

const CONFIG = {

  // ── Location (for weather) ──────────────────
  location: {
    lat: 42.0451,
    lon: -87.6877,
    label: "Evanston, IL",
    timezone: "America/Chicago",
  },

  // ── NYT Games ───────────────────────────────
  // Update streak once a day — just the number.
  // Clicking a tile on the dashboard marks it done; resets automatically at midnight.
  games: {
    streak: 187,
    games: [
      { abbr: "Wo", name: "Wordle",         url: "https://www.nytimes.com/games/wordle" },
      { abbr: "Co", name: "Connections",    url: "https://www.nytimes.com/games/connections" },
      { abbr: "St", name: "Strands",        url: "https://www.nytimes.com/games/strands" },
      { abbr: "Mc", name: "Mini Crossword", url: "https://www.nytimes.com/games/mini" },
    ],
  },

  // ── Sports — your followed teams ────────────
  // ESPN's undocumented API pulls live scores automatically.
  // Just keep this list current with your teams.
  sports: {
    teams: [
      { league: "mlb",  espnId: "112",  label: "Cubs",         abbr: "CHC" },
      { league: "mlb",  espnId: "116",  label: "Tigers",       abbr: "DET" },
      { league: "nfl",  espnId: "8",    label: "Lions",        abbr: "DET" },
      { league: "nhl",  espnId: "17",   label: "Red Wings",    abbr: "DET" },
      { league: "soccer/usa.mls", espnId: null, label: "— no MLS team", abbr: null },
    ],
    // College teams use different lookup
    college: [
      { label: "Northwestern Wildcats", search: "Northwestern" },
    ],
    // EPL team
    epl: { espnId: "18", label: "Tottenham", abbr: "TOT" },
  },

  // ── Job search pipeline ──────────────────────
  // Update org, role, status, and stage here as your search evolves.
  // "Touched today" button on the dashboard sets the last-contact date automatically.
  // status: "hot" | "warm" | "cold" | "watch"
  pipeline: [
    { org: "Disagree Better", role: "COO / Ops", status: "hot",   stage: "Exploratory call done" },
    { org: "org 2",           role: "—",         status: "watch", stage: "Watching" },
    { org: "org 3",           role: "—",         status: "warm",  stage: "Applied" },
  ],
  // Show nudge after this many days of silence
  pipelineNudgeAfter: 10,

  // ── JELS Expansion project ───────────────────
  jels: {
    groundbreakingDate: "2029-05-01",  // target
    openingDate:        "2030-08-01",  // target
    campaignGoal:       500000,        // total campaign goal $
    campaignRaised:     87000,         // update as pledges come in
    reserveTarget:      175000,        // pre-construction cash target
    reserveCurrent:     50000,         // already held / paid to architect
  },

  // ── Journal nudge ────────────────────────────
  // Add your own prompts. One is picked each day.
  // windowCloses: time in HH:MM (24h) local — nudge after this changes
  journalStreak: 23,
  journalWindowCloses: "08:00",
  journalPrompts: [
    "What's one decision from last week you'd make the same again, knowing what you know now?",
    "What's something you've been avoiding that's actually small?",
    "Who showed up for you this week, and did you tell them?",
    "What's the gap between how you want to show up and how you actually did today?",
    "What would you do differently about yesterday if you had it back?",
    "Name one thing you're grateful for that you haven't said out loud.",
    "What's a question you've been sitting with this week?",
    "Where did you feel most like yourself recently?",
    "What assumption are you carrying that might not be true?",
    "What's one thing your son taught you this week, even if he didn't mean to?",
    "When did you feel most present today, and what made that possible?",
    "What's something you know but haven't quite believed yet?",
  ],

  // ── Something to sit with ────────────────────
  // Update manually — once a week is the right cadence.
  sitWith: {
    type: "Essay · Politics",
    headline: "The Slow Death of the Permanent Campaign",
    desc: "A case for why the 24/7 political attention cycle is eroding the very deliberation it claims to cover — and what civic organizations are doing differently.",
    source: "The Atlantic",
    readTime: "~18 min",
    url: "https://www.theatlantic.com",
  },

  // ── Slow burns ───────────────────────────────
  // Things that matter but don't have weekly check-ins.
  // lastTouched: days since you last worked on this
  slowBurns: [
    { name: "Personal website",        lastTouched: 34 },
    { name: "LinkedIn rebrand",        lastTouched: 8  },
    { name: "Jasper's Game Workshop",  lastTouched: 12 },
    { name: "Coffee logging app",      lastTouched: 21 },
    { name: "Obsidian vault setup",    lastTouched: 45 },
  ],
  // Flag as overdue after N days
  slowBurnOverdue: 21,

};
