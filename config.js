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
    maxLeague: 3,   // league filler cap — keeps the card from outgrowing the briefing
  },

  // ── Orangetheory daily workout ──────────────
  // Just a link. Reddit blocks reading its data endpoints, so the dashboard
  // can't tell you whether today's thread is up — only take you to the sub.
  workout: {
    subreddit: "orangetheory",
  },

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

};
