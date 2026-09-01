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

  // ── Sports — team news ──────────────────────
  // Which teams get matched lives in the Worker (that's where filtering
  // happens). This is display only.
  //   maxItems: hard cap. Keep it low on purpose — a card that ends is the
  //   whole reason this exists instead of just opening The Athletic.
  sports: {
    url: "https://briefing.clintsievers.workers.dev/sports",
    maxItems: 6,
  },

  // ── Orangetheory daily workout ──────────────
  // Just a link. Reddit blocks reading its data endpoints, so the dashboard
  // can't tell you whether today's thread is up — only take you to the sub.
  workout: {
    subreddit: "orangetheory",
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
