// The oracle for the fixture builds. Deliberately independent of the package:
// plain string handling over the built HTML, so a bug in the engine's scan
// cannot also hide in the check. Notices are derived from what the page
// actually shows, never from a list the test hands the code.

import registry from "./marks-data.mjs";

const ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  reg: "®",
  trade: "™",
};

export function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#")
      return String.fromCodePoint(
        e[1].toLowerCase() === "x" ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1))
      );
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function textOf(html) {
  return decode(
    html
      .replace(/<(script|style|template)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, "")
      // Element boundaries separate words, except the inline wrappers a symbol
      // sits in ("Grafana<sup>®</sup>", "ClickHouse<span class=tm-symbol>®").
      .replace(/<(?!\/?(?:span|sup)\b)[^>]+>/g, " ")
      .replace(/<[^>]+>/g, "")
  );
}

/** Everything between the first <main …> and its </main>. */
export function mainOf(html) {
  const start = html.search(/<main[\s>]/);
  const end = html.lastIndexOf("</main>");
  if (start < 0 || end < 0) throw new Error("page has no <main>");
  return html.slice(start, end);
}

// The component renders <div|aside|section|footer data-tm-notices> with only
// <p>/<span> inside, so the first matching close tag ends it.
const NOTICES_BLOCK = /<(div|aside|section|footer)\b[^>]*\bdata-tm-notices\b[^>]*>([\s\S]*?)<\/\1>/;

/** The notices block's text, or null when the block was removed. */
export function noticesOf(html) {
  const m = NOTICES_BLOCK.exec(html);
  return m ? textOf(m[2]) : null;
}

const aliasesOf = (mark) => mark.aliases ?? [mark.name];
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const ALIASES = registry
  .flatMap((mark) => aliasesOf(mark).map((alias) => [alias, mark]))
  .sort((x, y) => y[0].length - x[0].length);
const SYMBOLED = new RegExp(
  `(?<![A-Za-z0-9])(${ALIASES.map(([a]) => escapeRe(a)).join("|")})[®™]`,
  "g"
);

/** How many times any alias of `mark` is immediately followed by a symbol. */
export function symbolCount(text, mark) {
  let n = 0;
  for (const m of text.matchAll(SYMBOLED)) {
    if (ALIASES.find(([a]) => a === m[1])?.[1] === mark) n++;
  }
  return n;
}

function noticed(notices, mark) {
  if (notices === null) return false;
  return (
    notices.includes(`${mark.name}${mark.symbol}`) ||
    Boolean(mark.notice && notices.includes(mark.notice))
  );
}

function segments(page, tag) {
  // Inline <style>/<script> (dev mode inlines CSS) can mention "<code>" in a
  // comment; only real markup counts.
  const html = page.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "");
  return [...html.matchAll(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`, "gi"))].map((m) => m[0]);
}

/**
 * Check one page against its golden expectation:
 *   marked   names whose symbol shows in <main> — exactly once each, no others
 *   noticed  names with a notice — exactly these
 *   triggered names noticed through a trigger only (no symbol needed)
 *   block    whether the notices block survives
 *   inserted how many symbols the engine inserted (default: marked.length)
 */
export function checkSitePage(html, expected, label) {
  const fail = (msg) => {
    throw new Error(`${label}: ${msg}`);
  };
  // Starlight renders its footer — and so the notices — inside <main>.
  const main = mainOf(html.replace(NOTICES_BLOCK, ""));
  const text = textOf(main);
  const notices = noticesOf(html);

  for (const mark of registry) {
    const count = symbolCount(text, mark);
    const want = expected.marked.includes(mark.name) ? 1 : 0;
    if (count !== want)
      fail(`${mark.name}: ${count} symbol(s) in <main>, expected ${want}\n${text}`);
    if (mark.owner || mark.notice) {
      const has = noticed(notices, mark);
      if (has !== expected.noticed.includes(mark.name)) {
        fail(
          `${mark.name}: notice ${has ? "present" : "absent"}, expected the opposite\nnotices: ${notices}`
        );
      }
    }
  }

  // The invariant this package exists for: no notice without a visible symbol
  // (except marks the page names only through a trigger).
  for (const name of expected.noticed) {
    if (!expected.marked.includes(name) && !(expected.triggered ?? []).includes(name)) {
      fail(`${name} is noticed but not marked`);
    }
  }

  if ((notices !== null) !== expected.block)
    fail(`notices block ${notices === null ? "missing" : "present"}`);
  if (
    expected.block &&
    !notices.includes("All other trademarks are the property of their respective owners.")
  ) {
    fail("catch-all missing");
  }

  const inserted = (main.match(/class="tm-symbol"/g) ?? []).length;
  const wantInserted = expected.inserted ?? expected.marked.length;
  if (inserted !== wantInserted) fail(`${inserted} inserted symbol(s), expected ${wantInserted}`);

  for (const tag of ["h1", "h2", "h3", "h4", "h5", "h6", "code", "pre", "title", "nav", "footer"]) {
    for (const seg of segments(html, tag)) {
      if (seg.includes("tm-symbol")) fail(`symbol inserted inside <${tag}>: ${seg.slice(0, 200)}`);
    }
  }
  const outside = html.replace(NOTICES_BLOCK, "").replace(main, "");
  if (outside.includes('class="tm-symbol"')) fail("symbol inserted outside <main>");
}

export const SITE_EXPECTATIONS = {
  static: {
    "index.html": {
      marked: ["ClickHouse", "Acme Widget"],
      noticed: ["ClickHouse", "Bluetooth"],
      triggered: ["Bluetooth"],
      block: true,
    },
    "markdown/index.html": {
      marked: ["Grafana Loki", "Grafana"],
      noticed: ["Grafana Loki", "Grafana"],
      block: true,
    },
    "mdx/index.html": { marked: ["ClickHouse"], noticed: ["ClickHouse"], block: true },
    "none/index.html": { marked: [], noticed: [], block: false },
    "hand/index.html": {
      marked: ["ClickHouse", "Grafana"],
      noticed: ["ClickHouse", "Grafana"],
      block: true,
      inserted: 0,
    },
    "stream/index.html": {
      marked: ["Docker", "Kubernetes"],
      noticed: ["Docker", "Kubernetes"],
      block: true,
    },
  },
  ssr: { marked: ["Grafana", "Docker"], noticed: ["Grafana", "Docker"], block: true },
};

/** Starlight pages: the same oracle, plus chrome that must stay unmarked. */
export function checkStarlight(html, expected, label) {
  checkSitePage(html, expected, label);
  const fail = (msg) => {
    throw new Error(`${label}: ${msg}`);
  };
  for (const cls of [
    "sl-link-button",
    "starlight-aside__title",
    "pagination-links",
    "right-sidebar",
  ]) {
    const re = new RegExp(
      `<(\\w[\\w-]*)[^>]*class="[^"]*\\b${cls}\\b[^"]*"[^>]*>[\\s\\S]*?</\\1>`,
      "g"
    );
    for (const m of html.matchAll(re)) {
      if (m[0].includes("tm-symbol")) fail(`symbol inserted inside .${cls}`);
    }
  }
  for (const tag of ["starlight-toc", "mobile-starlight-toc"]) {
    for (const seg of segments(html, tag))
      if (seg.includes("tm-symbol")) fail(`symbol inside <${tag}>`);
  }
}

export const STARLIGHT_EXPECTATIONS = {
  "index.html": {
    marked: ["ClickHouse", "Grafana"],
    noticed: ["ClickHouse", "Grafana"],
    block: true,
  },
  "guide/index.html": {
    marked: ["Docker", "Grafana Loki"],
    noticed: ["Docker", "Grafana Loki"],
    block: true,
  },
};

/** Exact notice-link markup the fixtures must produce (escaped, rel, no target). */
export const LINK_EXPECTATIONS = {
  "index.html": [
    '<a class="tm-notice__link" href="https://clickhouse.example/?ref=a&amp;b=1" rel="noopener noreferrer">https://clickhouse.example/?ref=a&amp;b=1</a>',
  ],
  // Grafana and Grafana Loki share one owner sentence and one URL: linked once.
  "markdown/index.html": [
    '<a class="tm-notice__link" href="https://grafana.example" rel="noopener noreferrer">https://grafana.example</a>',
  ],
};

export function checkLinks(html, expected, label) {
  const anchors = html.match(/<a class="tm-notice__link"[^>]*>[^<]*<\/a>/g) ?? [];
  if (JSON.stringify(anchors) !== JSON.stringify(expected)) {
    throw new Error(
      `${label}: notice links ${JSON.stringify(anchors)}, expected ${JSON.stringify(expected)}`
    );
  }
}
