// Checks the /lectionary route against a made-up feed, through the Worker's
// own fetch handler. Usage: npm run test:lectionary
//
// The feed below copies the quirks of the real WELSTech CW 2021 calendar
// (checked 2026-11-01): folds that split an escape or a word, escaped
// commas, garbled dashes (U+0096), non-breaking spaces, labels in either
// case and in varying order, a label and reference on one line, a reference
// split over two lines, a label glued to the number before it, "Gospel Acc"
// verses, HTML, an event with no description, two events on one date, and a
// cancelled event. The real file is never committed.

const ev = (...lines) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'];
const FEED = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//lectionary-test//EN',
  // Uppercase labels, Psalm last, and a fold that splits the "\n" escape.
  ...ev('DTSTART;VALUE=DATE:20261101', 'DTEND;VALUE=DATE:20261102',
    'DESCRIPTION:FIRST READING\\nRevelation 7:9-17 \\nSECOND READING\\n1 John 3:1-3 \\',
    ' nGOSPEL\\nMatthew 5:1-12 \\nPSALM\\n149',
    "SUMMARY:All Saints' Day", 'STATUS:CONFIRMED'),
  ...ev('DTSTART;VALUE=DATE:20261108', 'DESCRIPTION:First Reading\\nIsaiah 52:1-6\\nPsalm\\n90\\nSecond Reading\\n1 Thessalonians 5:1-11\\nGospel\\nMatthew 25:1-13',
    'SUMMARY:Twenty-fourth Sunday after Pentecost (Proper 27)'),
  ...ev('DTSTART;VALUE=DATE:20261108', 'SUMMARY:Cancelled duplicate', 'STATUS:CANCELLED',
    'DESCRIPTION:Gospel\\nJohn 1:1'),
  // No description at all.
  ...ev('DTSTART;VALUE=DATE:20261126', 'SUMMARY:Thanksgiving'),
  // Escaped commas, and a SUMMARY with a trailing space.
  ...ev('DTSTART;VALUE=DATE:20261129', 'DESCRIPTION:First Reading\\nIsaiah 61:1-3\\,10-11\\nPsalm\\n24\\nSecond Reading\\n1 Corinthians 1:3-9\\nGospel \\nMark 11:1-10 ',
    'SUMMARY:First Sunday in Advent '),
  // A fold in the middle of a word, leaving the book alone on its line.
  ...ev('DTSTART;VALUE=DATE:20261220',
    'DESCRIPTION:First Reading\\n2 Samuel 7:8-16\\nPsalm\\n139\\nSecond Reading\\nRom',
    ' ans \\n16:25-27\\nGospel\\nLuke 1:26-38',
    'SUMMARY:Fourth Sunday in Advent'),
  // Label and reference on one line; a fold right after "Titus".
  ...ev('DTSTART;VALUE=DATE:20261224',
    'DESCRIPTION:First Reading\\nIsaiah 7:10-14\\nPsalm 96 \\nSecond Reading\\nTitus',
    '  3:4-7 \\nGospel\\nLuke 2:1-20',
    'SUMMARY:Nativity of Our Lord - Christmas Eve'),
  ...ev('DTSTART;VALUE=DATE:20261225', 'DESCRIPTION:First Reading\\nMicah 5:2-5a\\nPsalm \\n98\\nSecond Reading\\nGalatians 4:4-7\\nGospel\\nJohn 1:1-18',
    'SUMMARY:Nativity of our Lord - Christmas Day'),
  ...ev('DTSTART;VALUE=DATE:20261227', 'DESCRIPTION:First Reading\\n1 Kings 8:6-13\\nPsalm\\n111\\nSecond Reading\\nColossians 3:12-17\\nGospel\\n Luke 2:22-40',
    'SUMMARY:First Sunday after Christmas'),
  // Two events on one date, shown in feed order.
  ...ev('DTSTART;VALUE=DATE:20270321', 'DESCRIPTION:Reading\\, Mark 14:1-15:47', 'SUMMARY:Sunday of the Passion'),
  ...ev('DTSTART;VALUE=DATE:20270321', 'DESCRIPTION:First Reading\\nZechariah 9:9-12\\nPsalm\\n24 \\nSecond Reading\\nHebrews 12:1-3\\nGospel\\nMark 11:1-10',
    'SUMMARY:Palm Sunday '),
  // Garbled dashes and a non-breaking space.
  ...ev('DTSTART;VALUE=DATE:20270326', 'DESCRIPTION:First Reading\\nIsaiah 52:13\u009653:12\\nPsalm\\n22 \\nSecond Reading\\nHebrews 4:14\u009616\\nGospel\\nJohn 19:17\u009630',
    'SUMMARY:Good Friday'),
  // A label glued to the number before it, and a "Gospel Acc" whose verse,
  // on the next line, starts with "Psalm".
  ...ev('DTSTART;VALUE=DATE:20270328', 'DESCRIPTION:First Reading\\nJob 19:23-27\\nPsalm\\n118Second Reading\\n1 Corinthians 15:19-26\\nGospel Acc\\nPsalm 118:24\\nGospel\\nMark 16:1-8',
    'SUMMARY:Resurrection of our Lord - Easter Day'),
  // The older HTML format, with hymns and a sermon-text asterisk.
  ...ev('DTSTART;VALUE=DATE:20270404', 'DESCRIPTION:<b>First Reading</b> Acts 5:12-20<br><b>Psalm </b>16<br><b>Gospel Acc</b> John 20:29<br><b>Gospel </b>*John 20:19-31<br><br><b>Opening </b>466 A Hymn',
    'SUMMARY:Second Sunday of Easter'),
  // A description with no reading in it.
  ...ev('DTSTART;VALUE=DATE:20270411', 'DESCRIPTION:Opening\\n466\\nClosing\\n470', 'SUMMARY:Third Sunday of Easter'),
  'END:VCALENDAR',
].join('\r\n');

const IN_FILE = 15;
const W = n => `(${IN_FILE} in file, ${n} in window)`;
const F = {
  allSaints: ['2026-11-01', 'Sunday', "All Saints' Day", 'First Reading: Revelation 7:9-17 | Psalm: Psalm 149 | Second Reading: 1 John 3:1-3 | Gospel: Matthew 5:1-12'],
  proper27: ['2026-11-08', 'Sunday', 'Twenty-fourth Sunday after Pentecost (Proper 27)', 'First Reading: Isaiah 52:1-6 | Psalm: Psalm 90 | Second Reading: 1 Thessalonians 5:1-11 | Gospel: Matthew 25:1-13'],
  thanks: ['2026-11-26', 'Thursday', 'Thanksgiving', 'note: no readings listed'],
  advent1: ['2026-11-29', 'Sunday', 'First Sunday in Advent', 'First Reading: Isaiah 61:1-3,10-11 | Psalm: Psalm 24 | Second Reading: 1 Corinthians 1:3-9 | Gospel: Mark 11:1-10'],
  advent4: ['2026-12-20', 'Sunday', 'Fourth Sunday in Advent', 'First Reading: 2 Samuel 7:8-16 | Psalm: Psalm 139 | Second Reading: Romans 16:25-27 | Gospel: Luke 1:26-38'],
  eve: ['2026-12-24', 'Thursday', 'Nativity of Our Lord - Christmas Eve', 'First Reading: Isaiah 7:10-14 | Psalm: Psalm 96 | Second Reading: Titus 3:4-7 | Gospel: Luke 2:1-20'],
  day: ['2026-12-25', 'Friday', 'Nativity of our Lord - Christmas Day', 'First Reading: Micah 5:2-5a | Psalm: Psalm 98 | Second Reading: Galatians 4:4-7 | Gospel: John 1:1-18'],
  xmas1: ['2026-12-27', 'Sunday', 'First Sunday after Christmas', 'First Reading: 1 Kings 8:6-13 | Psalm: Psalm 111 | Second Reading: Colossians 3:12-17 | Gospel: Luke 2:22-40'],
  passion: ['2027-03-21', 'Sunday', 'Sunday of the Passion', 'Reading: Mark 14:1-15:47'],
  palm: ['2027-03-21', 'Sunday', 'Palm Sunday', 'First Reading: Zechariah 9:9-12 | Psalm: Psalm 24 | Second Reading: Hebrews 12:1-3 | Gospel: Mark 11:1-10'],
  goodFri: ['2027-03-26', 'Friday', 'Good Friday', 'First Reading: Isaiah 52:13–53:12 | Psalm: Psalm 22 | Second Reading: Hebrews 4:14–16 | Gospel: John 19:17–30'],
  easter: ['2027-03-28', 'Sunday', 'Resurrection of our Lord - Easter Day', 'First Reading: Job 19:23-27 | Psalm: Psalm 118 | Second Reading: 1 Corinthians 15:19-26 | Gospel: Mark 16:1-8'],
  easter2: ['2027-04-04', 'Sunday', 'Second Sunday of Easter', 'First Reading: Acts 5:12-20 | Psalm: Psalm 16 | Gospel: John 20:19-31'],
  easter3: ['2027-04-11', 'Sunday', 'Third Sunday of Easter', ''],
};

// Day asked → [the Sunday, events in order, sources line].
const CASES = {
  '2026-11-01': ['2026-11-01', [F.allSaints], `ok ${W(1)}`],          // Sunday: that day's
  '2026-11-02': ['2026-11-08', [F.proper27], `ok ${W(1)}`],           // Monday: the coming Sunday; cancelled left out
  '2026-11-23': ['2026-11-29', [F.thanks, F.advent1], `ok ${W(2)}`],  // a midweek service ahead
  '2026-11-27': ['2026-11-29', [F.advent1], `ok ${W(1)}`],            // ...and gone once it's past
  '2026-11-26': ['2026-11-29', [F.thanks, F.advent1], `ok ${W(2)}`],  // ...but shown on its own day
  '2026-12-14': ['2026-12-20', [F.advent4], `ok ${W(1)}`],
  '2026-12-21': ['2026-12-27', [F.eve, F.day, F.xmas1], `ok ${W(3)}`],
  '2026-12-26': ['2026-12-27', [F.xmas1], `ok ${W(1)}`],              // Saturday
  '2027-03-15': ['2027-03-21', [F.passion, F.palm], `ok ${W(2)}`],
  '2027-03-22': ['2027-03-28', [F.goodFri, F.easter], `ok ${W(2)}`],
  '2027-03-29': ['2027-04-04', [F.easter2], `ok ${W(1)}`],
  '2027-04-05': ['2027-04-11', [F.easter3], `parse-miss ${W(1)}`],
  '2027-04-12': ['2027-04-18', [], `no-items ${W(0)}`],               // past the end of the feed
};

const flat = e => [e.date, e.day, e.name, e.note ? `note: ${e.note}` : e.readings.map(r => `${r.label}: ${r.ref}`).join(' | ')];

// Stand-ins for the network and the Workers cache.
let respond = () => new Response(FEED, { status: 200 });
globalThis.fetch = async () => respond();
const puts = [];
globalThis.caches = { default: { match: async () => undefined, put: async (k, r) => { puts.push([k.url, r.headers.get('cache-control')]); } } };
const worker = (await import('../src/index.js')).default;
const get = async q => worker.fetch(new Request(`https://worker.test/lectionary${q}`), {}, {});

let failed = 0;
const check = (name, problems) => {
  if (problems.length) failed++;
  console.log(`${problems.length ? 'FAIL' : 'ok  '} ${name}${problems.map(p => '\n    ' + p).join('')}`);
};

for (const [day, [sunday, want, wantSource]] of Object.entries(CASES)) {
  const res = await get(`?date=${day}`);
  const body = await res.json();
  const got = body.events.map(flat);
  const p = [];
  if (res.status !== 200) p.push(`status ${res.status}`);
  if (body.sunday !== sunday) p.push(`sunday want ${sunday} got ${body.sunday}`);
  if (JSON.stringify(got) !== JSON.stringify(want)) p.push(`events\n      want ${JSON.stringify(want)}\n      got  ${JSON.stringify(got)}`);
  if (body.sources.lectionary !== wantSource) p.push(`sources want ${wantSource} got ${body.sources.lectionary}`);
  check(day, p);
}

// Failures must say what failed, not look like an empty week.
const FAILS = [
  ['HTTP 503', () => new Response('busy', { status: 503 })],
  ['not-ics', () => new Response('<html>Sign in</html>', { status: 200 })],
  ['empty-file', () => new Response('', { status: 200 })],
  ['error: network down', () => { throw new Error('network down'); }],
];
for (const [want, fn] of FAILS) {
  respond = fn;
  const body = await (await get('?date=2026-11-02')).json();
  check(`fails as "${want}"`, [
    ...(body.sources.lectionary !== want ? [`got ${body.sources.lectionary}`] : []),
    ...(body.events.length ? ['events not empty'] : []),
    ...(body.sunday !== '2026-11-08' ? ['sunday missing'] : []),
  ]);
}
respond = () => new Response(FEED, { status: 200 });

// Bad dates are refused, not guessed at.
for (const bad of ['2026-13-01', '2026-02-30', 'tomorrow']) {
  const res = await get(`?date=${bad}`);
  check(`refuses date=${bad}`, res.status === 400 ? [] : [`status ${res.status}`]);
}

// Caching: the day is in the key, success holds 12 hours, failure 5 minutes.
puts.length = 0;
await get('?date=2026-11-02');
respond = () => new Response('busy', { status: 503 });
await get('?date=2026-11-03');
const [okPut, failPut] = puts;
check('cache key carries the day; ok 12h, failure 5 min', [
  ...(!okPut[0].includes('date=2026-11-02') ? [`ok key ${okPut[0]}`] : []),
  ...(okPut[1] !== 'public, max-age=43200' ? [`ok cache-control ${okPut[1]}`] : []),
  ...(failPut[1] !== 'public, max-age=300' ? [`failure cache-control ${failPut[1]}`] : []),
]);

// With no date given, the day is Chicago's today, and it's in the key.
respond = () => new Response(FEED, { status: 200 });
puts.length = 0;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
const body = await (await get('')).json();
check(`no date means Chicago today (${today})`, [
  ...(body.today !== today ? [`today ${body.today}`] : []),
  ...(!puts[0][0].includes(`date=${today}`) ? [`key ${puts[0][0]}`] : []),
]);

const total = Object.keys(CASES).length + FAILS.length + 3 + 2;
console.log(failed ? `\n${failed} check(s) failed` : `\nall ${total} checks pass`);
process.exit(failed ? 1 : 0);
