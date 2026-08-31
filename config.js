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

  // ── Orangetheory daily workout ──────────────
  // The daily thread is posted the evening before and titled with the date
  // it's FOR. We match on that date, so titleContains only needs to be the
  // stable word in the title — not the whole phrase.
  workout: {
    subreddit: "orangetheory",
    titleContains: "workout",
    // The mods flair the live thread "Today's Workout". That's the signal we
    // trust first; date-in-title is only the fallback.
    todayFlairContains: "today",
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
  // FALLBACK ONLY — the briefing skill writes this live after each run.
  // This shows only if the Notion fetch fails (e.g. before first briefing run).
  // Update manually if you want something here on days the briefing doesn't run.
  sitWith: {
    type: "Essay · Culture",
    headline: "Run today's briefing to populate this automatically.",
    desc: "The briefing skill will write a long-read recommendation here each morning.",
    source: "—",
    readTime: "—",
    url: "#",
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
