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

  // ── Orangetheory daily workout thread ───────
  // Just a link, at the foot of the Orangetheory card. Reddit blocks reading
  // its data endpoints, so the dashboard can't tell you whether today's
  // thread is up — only take you to the sub.
  workout: {
    subreddit: "orangetheory",
  },

  // ── Orangetheory card ───────────────────────
  // Fallback monthly goals, in miles. The month's row in Notion ("OTF
  // Monthly Posts": Tread Goal, Rower Goal) wins; a blank field there falls
  // back to these. Tread 32 is the usual target; rower is a bonus.
  // The card converts rower meters to miles at 1609.344 m per mile.
  otf: {
    url: "https://briefing.clintsievers.workers.dev/otf",
    staleHours: 36,   // older than this, the card says when it last updated
    goals: {
      default: { tread: 32, rower: 15 },
    },
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
