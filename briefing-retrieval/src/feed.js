// Minimal RSS 2.0 / Atom parser. Deliberately regex-based: the free Workers
// plan allows ~10ms CPU per invocation, and a full XML parser over several
// feeds can blow through that. Feeds here are well-formed enough for this.

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', mdash: '—', ndash: '–', hellip: '…' };

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

const unCdata = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');

// Text of an element, CDATA unwrapped and entities decoded once.
function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decodeEntities(unCdata(m[1])).trim() : '';
}

export function stripHtml(s) {
  return decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export const wordCount = text => (text ? text.split(/\s+/).filter(Boolean).length : 0);

function atomLink(block) {
  const links = [...block.matchAll(/<link\b([^>]*)\/?>/gi)].map(m => m[1]);
  const pick = links.find(a => /rel=["']alternate["']/.test(a)) || links.find(a => !/rel=/.test(a)) || links[0];
  const href = pick && pick.match(/href=["']([^"']+)["']/);
  return href ? decodeEntities(href[1]) : '';
}

export function parseFeed(xml) {
  const blocks = xml.split(/<(?:item|entry)(?=[\s>])/i).slice(1).map(b => b.split(/<\/(?:item|entry)>/i)[0]);
  return blocks.map(b => {
    let link = tag(b, 'link');
    if (!link || link.startsWith('<')) link = atomLink(b);
    if (!link) {
      const guid = tag(b, 'guid');
      if (/^https?:/.test(guid)) link = guid;
    }
    const content = tag(b, 'content:encoded') || tag(b, 'content');
    const words = wordCount(stripHtml(content));
    return {
      title: stripHtml(tag(b, 'title')),
      url: link.trim(),
      rawDate: tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'dc:date') || tag(b, 'updated'),
      summary: stripHtml(tag(b, 'description') || tag(b, 'summary')).slice(0, 500),
      author: stripHtml(tag(b, 'dc:creator') || tag(b, 'name') || tag(b, 'author')),
      // Only trust a word count from a full-text body; teaser-only feeds give ~50.
      word_count: words >= 300 ? words : null,
    };
  });
}

const TRACKING = /^(utm_|smid$|smtyp$|ref$|referrer$|partner$|cmp$|src$|fbclid$|gclid$|mc_|_hs|at_|itm_|intcmp$|mod$)/i;

export function canonicalUrl(u) {
  try {
    const x = new URL(u);
    x.hash = '';
    for (const k of [...x.searchParams.keys()]) if (TRACKING.test(k)) x.searchParams.delete(k);
    x.protocol = 'https:';
    return x.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}
