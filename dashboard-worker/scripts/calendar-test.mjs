// Checks the /calendar route against a made-up feed, through the Worker's own
// fetch handler. Usage: npm run test:calendar (runs with TZ=UTC).
//
// Run under UTC on purpose: a Worker runs in UTC, and a time that ical.js
// leaves "floating" reads as the machine's zone. On a Mac set to Chicago a
// floating-time bug passes; under UTC it fails here instead of in production.
// Every event below is invented. No real calendar data goes in this file.

if (process.env.TZ !== 'UTC') {
  console.error('Run with TZ=UTC (npm run test:calendar).');
  process.exit(1);
}

const VTZ = {
  chicago: ['BEGIN:VTIMEZONE', 'TZID:America/Chicago',
    'BEGIN:DAYLIGHT', 'TZOFFSETFROM:-0600', 'TZOFFSETTO:-0500', 'DTSTART:19700308T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'END:DAYLIGHT',
    'BEGIN:STANDARD', 'TZOFFSETFROM:-0500', 'TZOFFSETTO:-0600', 'DTSTART:19701101T020000', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'END:STANDARD',
    'END:VTIMEZONE'],
  newYork: ['BEGIN:VTIMEZONE', 'TZID:America/New_York',
    'BEGIN:DAYLIGHT', 'TZOFFSETFROM:-0500', 'TZOFFSETTO:-0400', 'DTSTART:19700308T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'END:DAYLIGHT',
    'BEGIN:STANDARD', 'TZOFFSETFROM:-0400', 'TZOFFSETTO:-0500', 'DTSTART:19701101T020000', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'END:STANDARD',
    'END:VTIMEZONE'],
  // Apple writes zones it can't name as fixed-offset labels like this.
  gmtMinus5: ['BEGIN:VTIMEZONE', 'TZID:GMT-0500',
    'BEGIN:STANDARD', 'TZOFFSETFROM:-0500', 'TZOFFSETTO:-0500', 'DTSTART:16010101T000000', 'END:STANDARD',
    'END:VTIMEZONE'],
};

const ev = (...lines) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'];
const FEED = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//calendar-test//EN',
  ...VTZ.chicago, ...VTZ.newYork, ...VTZ.gmtMinus5,
  // Third Tuesday / third Wednesday, starting on the 21st and 15th. The old
  // expander repeated these on the 21st and 15th of every month.
  ...ev('UID:tue', 'SUMMARY:Third Tuesday sweep', 'DTSTART;TZID=America/Chicago:20251021T090000', 'RRULE:FREQ=MONTHLY;BYDAY=3TU'),
  ...ev('UID:wed', 'SUMMARY:Third Wednesday sweep', 'DTSTART;TZID=America/Chicago:20251015T090000', 'RRULE:FREQ=MONTHLY;BYDAY=3WE'),
  // The same idea written the BYSETPOS way, as Apple does.
  ...ev('UID:thu', 'SUMMARY:Third Thursday (BYSETPOS)', 'DTSTART;TZID=America/Chicago:20260219T180000', 'RRULE:FREQ=MONTHLY;BYDAY=TH;BYSETPOS=3'),
  // Third Friday at 3pm New York = 2pm Chicago, on both sides of Nov 1.
  ...ev('UID:fri', 'SUMMARY:Third Friday call', 'DTSTART;TZID=America/New_York:20260320T150000',
    'DTEND;TZID=America/New_York:20260320T160000', 'RRULE:FREQ=MONTHLY;BYDAY=3FR'),
  // Monthly on the 31st: months without one are skipped, not rolled over.
  ...ev('UID:eom', 'SUMMARY:Month-end review', 'DTSTART;VALUE=DATE:20260131', 'RRULE:FREQ=MONTHLY'),
  ...ev('UID:lunch', 'SUMMARY:Weekly lunch', 'DTSTART;TZID=America/Chicago:20261007T120000', 'RRULE:FREQ=WEEKLY',
    'EXDATE;TZID=America/Chicago:20261014T120000'),
  // A zone with no VTIMEZONE in the file, and an EXDATE written in UTC.
  ...ev('UID:mtn', 'SUMMARY:Mountain standup', 'DTSTART;TZID=America/Denver:20261007T100000', 'RRULE:FREQ=WEEKLY;COUNT=6',
    'EXDATE:20261014T160000Z'),
  // A moved instance: Monday the 12th moves to Tuesday the 13th at 11.
  ...ev('UID:oneone', 'SUMMARY:Weekly 1:1', 'DTSTART;TZID=America/Chicago:20261005T100000', 'RRULE:FREQ=WEEKLY;COUNT=4'),
  ...ev('UID:oneone', 'SUMMARY:Weekly 1:1 (moved)', 'RECURRENCE-ID;TZID=America/Chicago:20261012T100000',
    'DTSTART;TZID=America/Chicago:20261013T110000'),
  ...ev('UID:gmt', 'SUMMARY:Offset-label meeting', 'DTSTART;TZID=GMT-0500:20261021T100000'),
  ...ev('UID:pac', 'SUMMARY:Pacific call', 'DTSTART;TZID=America/Los_Angeles:20261021T080000'),
  ...ev('UID:mars', 'SUMMARY:Unknown zone', 'DTSTART;TZID=Mars/Olympus:20261022T090000'),
  ...ev('UID:off', 'SUMMARY:Day off', 'DTSTART;VALUE=DATE:20261021', 'DTEND;VALUE=DATE:20261022'),
  ...ev('UID:cxl', 'SUMMARY:Cancelled thing', 'STATUS:CANCELLED', 'DTSTART:20261021T180000Z'),
  // Three that can't be read: a line with no colon, a rule ical.js rejects,
  // and a daily series too old to reach today within the step cap.
  ...ev('UID:broken', 'SUMMARY:Broken', 'THIS LINE HAS NO COLON', 'DTSTART:20261021T170000Z'),
  ...ev('UID:badrule', 'SUMMARY:Bad rule', 'DTSTART:20261001T170000Z', 'RRULE:FREQ=SOMETIMES'),
  ...ev('UID:ancient', 'SUMMARY:Ancient daily', 'DTSTART;VALUE=DATE:20000101', 'RRULE:FREQ=DAILY'),
  'END:VCALENDAR',
].join('\r\n');

// Day → expected [title, start, end] in order, and the expected sources line.
// 17 VEVENTs. "Unknown zone" is the one fallback, counted on every day. The
// bad rule and the ancient series are always read, so always skipped; the
// broken event only near its own date.
const T = 'ok (17 in file, ';
const CASES = {
  '2026-10-12': [[], `${T}0 on 2026-10-12, 2 skipped, 1 fallback)`],
  '2026-10-13': [[['Weekly 1:1 (moved)', '2026-10-13T16:00:00.000Z', null]], `${T}1 on 2026-10-13, 2 skipped, 1 fallback)`],
  '2026-10-14': [[], `${T}0 on 2026-10-14, 2 skipped, 1 fallback)`],
  '2026-10-15': [[['Third Thursday (BYSETPOS)', '2026-10-15T23:00:00.000Z', null]], `${T}1 on 2026-10-15, 2 skipped, 1 fallback)`],
  '2026-10-16': [[['Third Friday call', '2026-10-16T19:00:00.000Z', '2026-10-16T20:00:00.000Z']], `${T}1 on 2026-10-16, 2 skipped, 1 fallback)`],
  '2026-10-19': [[['Weekly 1:1', '2026-10-19T15:00:00.000Z', null]], `${T}1 on 2026-10-19, 2 skipped, 1 fallback)`],
  '2026-10-20': [[['Third Tuesday sweep', '2026-10-20T14:00:00.000Z', null]], `${T}1 on 2026-10-20, 3 skipped, 1 fallback)`],
  '2026-10-21': [[
    ['Day off', null, null],
    ['Third Wednesday sweep', '2026-10-21T14:00:00.000Z', null],
    ['Offset-label meeting', '2026-10-21T15:00:00.000Z', null],
    ['Pacific call', '2026-10-21T15:00:00.000Z', null],
    ['Mountain standup', '2026-10-21T16:00:00.000Z', null],
    ['Weekly lunch', '2026-10-21T17:00:00.000Z', null],
  ], `${T}6 on 2026-10-21, 3 skipped, 1 fallback)`],
  '2026-10-22': [[['Unknown zone', '2026-10-22T14:00:00.000Z', null]], `${T}1 on 2026-10-22, 3 skipped, 1 fallback)`],
  '2026-10-31': [[['Month-end review', null, null]], `${T}1 on 2026-10-31, 2 skipped, 1 fallback)`],
  '2026-11-17': [[['Third Tuesday sweep', '2026-11-17T15:00:00.000Z', null]], `${T}1 on 2026-11-17, 2 skipped, 1 fallback)`],
  '2026-11-20': [[['Third Friday call', '2026-11-20T20:00:00.000Z', '2026-11-20T21:00:00.000Z']], `${T}1 on 2026-11-20, 2 skipped, 1 fallback)`],
  '2026-11-30': [[], `${T}0 on 2026-11-30, 2 skipped, 1 fallback)`],
  '2026-12-01': [[], `${T}0 on 2026-12-01, 2 skipped, 1 fallback)`],
  '2026-12-31': [[['Month-end review', null, null]], `${T}1 on 2026-12-31, 2 skipped, 1 fallback)`],
};

// Stand-ins for the network and the Workers cache.
globalThis.fetch = async () => new Response(FEED, { status: 200 });
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
const worker = (await import('../src/index.js')).default;
const env = { READ_KEY: 'test', CAL_ICS_1: 'https://calendar.test/feed.ics' };

let failed = 0;
for (const [day, [want, wantSource]] of Object.entries(CASES)) {
  const res = await worker.fetch(new Request(`https://worker.test/calendar?date=${day}`, { headers: { 'X-Read-Key': 'test' } }), env, {});
  const body = await res.json();
  const got = body.events.map(e => [e.title, e.start, e.end]);
  const problems = [];
  if (res.status !== 200) problems.push(`status ${res.status}`);
  if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`events\n      want ${JSON.stringify(want)}\n      got  ${JSON.stringify(got)}`);
  if (body.sources.google !== wantSource) problems.push(`sources\n      want ${wantSource}\n      got  ${body.sources.google}`);
  if (body.sources.icloud !== 'unset') problems.push(`icloud source ${body.sources.icloud}`);
  if (problems.length) failed++;
  console.log(`${problems.length ? 'FAIL' : 'ok  '} ${day}${problems.map(p => '\n    ' + p).join('')}`);
}
console.log(failed ? `\n${failed} day(s) failed` : `\nall ${Object.keys(CASES).length} days pass`);
process.exit(failed ? 1 : 0);
