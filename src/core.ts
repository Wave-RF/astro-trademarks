// The pure core: matching, first-mention marking and notice wording.
//
// No Astro imports and no DOM — everything here works on plain strings, so a
// `.md` twin generator, an `llms.txt` route or a component that renders its own
// text can use the same rules the HTML middleware does.
//
// Nothing in this package is legal advice, and nothing here ships a list of
// marks: every site supplies its own registry, because whether a mark is
// registered, who owns it, and what wording its owner asks for are claims the
// site makes and has to stand behind.

/** The two symbols a mark can carry. ® claims a registration; ™ does not. */
export type TrademarkSymbol = "®" | "™";

/** One third-party mark, as the site that names it describes it. */
export interface Trademark {
  /** Full name as it should read in the notice ("Apache Kafka"). */
  name: string;
  /**
   * How the mark is written in prose, when that differs from `name` — prose
   * says "Kafka", the notice says "Apache Kafka". Every alias is marked; the
   * longest match at a position wins, so listing both "Grafana Loki" and "Loki"
   * is safe. Defaults to `[name]`. When you set it, include `name` yourself if
   * the full name should be marked too.
   */
  aliases?: string[];
  /**
   * Words that make the mark's notice relevant but are never marked themselves
   * — "BLE" for Bluetooth, an abbreviation that is not the mark. A trigger
   * counts as a mention for the notice; it never takes the symbol and never
   * uses up the mark's first mention.
   */
  triggers?: string[];
  /**
   * ® only where the owner's own guidance says the mark is registered (in the
   * jurisdictions you publish to). ™ is the conservative default: marking a
   * registered mark ™ is harmless, claiming ® for one that is not is not.
   */
  symbol: TrademarkSymbol;
  /**
   * Legal owner, verbatim ("ClickHouse, Inc."). Optional: a mark with no
   * verified owner still gets its symbol, and the catch-all line covers it,
   * rather than a notice that names the wrong company.
   */
  owner?: string;
  /**
   * Appended after the owner, e.g. "in the U.S. and other countries". A leading
   * comma or semicolon attaches without a space (", registered in the U.S.").
   */
  qualifier?: string;
  /**
   * Verbatim notice, used instead of the generated sentence — for owners who
   * publish the wording they want. A mark with a `notice` always gets its own
   * line; it is never merged into another mark's sentence. Marks that carry the
   * SAME notice string share one line — the way to give a family of marks one
   * owner-mandated sentence ("Apple, macOS, and App Store are trademarks of…").
   */
  notice?: string;
  /**
   * The mark is used under license. `true` appends "and is used under
   * license"; a string names the licensee: "…, and any use of such mark by
   * <licensee> is under license."
   */
  licensed?: boolean | string;
  /**
   * Match aliases and triggers case-sensitively. Default `true`. Set `false`
   * only for marks that are never also a common word — "Thread" the protocol
   * must not match "thread" the noun.
   */
  caseSensitive?: boolean;
  /**
   * A URL rendered after this mark's notice, e.g. the owner's site — some
   * owners ask for attribution with a link. `http:` or `https:` only; anything
   * else (`javascript:`, `data:`, a relative path) is rejected by validation.
   * In HTML it becomes `<a href>` with the URL as its text; in plain text the
   * bare URL; in Markdown an autolink. Per mark, not per owner: when several
   * marks share one notice, their distinct links are listed once each, in the
   * sentence's mark order. Ignored on a mark that produces no notice (no
   * `owner` and no `notice`).
   */
  link?: string;
  /** URL of the owner's trademark guidance, for audits. Never rendered. */
  source?: string;
}

/** The catch-all sentence rendered after the notices by default. */
export const DEFAULT_CATCH_ALL =
  "All other trademarks are the property of their respective owners.";

// ---------------------------------------------------------------------------
// Registry validation and compilation
// ---------------------------------------------------------------------------

/**
 * Identity function that type-checks and validates a site's registry. Throws on
 * a symbol other than ® or ™, an empty alias, or one alias claimed by two
 * marks (which would make "first mention" ambiguous).
 */
export function defineTrademarks<const T extends readonly Trademark[]>(marks: T): T {
  compile(marks);
  return marks;
}

interface Entry {
  mark: Trademark;
  /** A trigger counts toward notices but is never marked. */
  trigger: boolean;
}

interface Compiled {
  /** Matches every case-sensitive alias/trigger, longest first. */
  sensitive: RegExp | null;
  /** Matches every case-insensitive alias/trigger, longest first. */
  insensitive: RegExp | null;
  sensitiveIndex: Map<string, Entry>;
  /** Keyed by lower-cased text. */
  insensitiveIndex: Map<string, Entry>;
}

const compiledCache = new WeakMap<readonly Trademark[], Compiled>();

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Boundaries are hand-rolled rather than \b: several marks end in a non-word
// character ("Node.js"), where \b anchors to the wrong side, and \b is ASCII.
//
// Left: not preceded by a letter, digit or underscore (inside another word), nor
// by / . @ # \ — a path segment, domain label, handle, anchor or escape, none of
// which is prose ("github.com/ClickHouse", "@Docker").
// Right: not followed by a letter, digit or underscore, nor by "." or "@" that
// continues into a word ("ClickHouse.com", "Node.jsx"). A plain trailing
// period, comma, hyphen or apostrophe is fine: "ClickHouse-backed",
// "ClickHouse's".
const LEFT = String.raw`(?<![\p{L}\p{N}\p{M}_/.@#\\])`;
const RIGHT = String.raw`(?![\p{L}\p{N}\p{M}_]|[.@][\p{L}\p{N}])`;

function aliasesOf(mark: Trademark): string[] {
  return mark.aliases ?? [mark.name];
}

function validateMark(mark: Trademark): void {
  if (!mark || typeof mark.name !== "string" || mark.name.trim() === "") {
    throw new TypeError("[astro-trademarks] every trademark needs a non-empty `name`.");
  }
  if (mark.symbol !== "®" && mark.symbol !== "™") {
    throw new TypeError(
      `[astro-trademarks] "${mark.name}": symbol must be "®" or "™", got ${JSON.stringify(mark.symbol)}.`
    );
  }
  for (const text of [...aliasesOf(mark), ...(mark.triggers ?? [])]) {
    if (typeof text !== "string" || text.trim() === "") {
      throw new TypeError(
        `[astro-trademarks] "${mark.name}": aliases and triggers must be non-empty strings.`
      );
    }
  }
  if (mark.link !== undefined && !isSafeLink(mark.link)) {
    throw new TypeError(
      `[astro-trademarks] "${mark.name}": link must be an absolute http: or https: URL with no spaces, quotes or angle brackets, got ${JSON.stringify(mark.link)}.`
    );
  }
}

function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

/**
 * An absolute http(s) URL that is also safe to print verbatim as an HTML
 * attribute value, link text, and a Markdown autolink: no whitespace, control
 * characters, quotes, backticks or angle brackets. The string is kept as
 * written (not normalised), so this is stricter than the URL parser.
 */
export function isSafeLink(link: unknown): link is string {
  if (typeof link !== "string" || /[\s"'`<>\\]/.test(link) || hasControlChar(link)) return false;
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return false;
  }
  return (url.protocol === "http:" || url.protocol === "https:") && /^https?:\/\//i.test(link);
}

function compile(marks: readonly Trademark[]): Compiled {
  const cached = compiledCache.get(marks);
  if (cached) return cached;

  const sensitiveIndex = new Map<string, Entry>();
  const insensitiveIndex = new Map<string, Entry>();
  // Lower-cased case-sensitive spellings, to catch a case-insensitive alias
  // that would swallow another mark's case-sensitive one.
  const sensitiveLower = new Map<string, Trademark>();

  for (const mark of marks) {
    validateMark(mark);
    const sensitive = mark.caseSensitive !== false;
    const add = (text: string, trigger: boolean) => {
      const key = text.toLowerCase();
      // One spelling claimed by two marks makes "which mark is this" ambiguous.
      // Case-sensitive spellings that differ only in case ("NGINX" / "Nginx")
      // do not collide; a case-insensitive one collides with every casing.
      const clash = sensitive
        ? (sensitiveIndex.get(text)?.mark ?? insensitiveIndex.get(key)?.mark)
        : (insensitiveIndex.get(key)?.mark ?? sensitiveLower.get(key));
      if (clash && clash !== mark) {
        throw new TypeError(
          `[astro-trademarks] "${text}" is claimed by both "${clash.name}" and "${mark.name}".`
        );
      }
      if (sensitive) {
        sensitiveIndex.set(text, { mark, trigger });
        sensitiveLower.set(key, mark);
      } else {
        insensitiveIndex.set(key, { mark, trigger });
      }
    };
    for (const alias of aliasesOf(mark)) add(alias, false);
    for (const trigger of mark.triggers ?? []) add(trigger, true);
  }

  const build = (keys: string[], flags: string) => {
    if (keys.length === 0) return null;
    const alternation = [...keys]
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp)
      .join("|");
    return new RegExp(`${LEFT}(?:${alternation})${RIGHT}`, flags);
  };

  const compiled: Compiled = {
    sensitive: build([...sensitiveIndex.keys()], "gu"),
    insensitive: build([...insensitiveIndex.keys()], "giu"),
    sensitiveIndex,
    insensitiveIndex,
  };
  compiledCache.set(marks, compiled);
  return compiled;
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

/** One mention found in a string. Exported for the HTML engine. */
export interface Mention {
  /** Start index in the scanned string. */
  start: number;
  /** End index (exclusive). The symbol goes here. */
  end: number;
  mark: Trademark;
  /** Matched a trigger, not an alias: counts toward notices, never marked. */
  trigger: boolean;
  /** Already followed by ® or ™ in the text itself. */
  alreadyMarked: boolean;
}

const SYMBOL_CHARS = new Set(["®", "™"]);

/** True when `text` (starting at `index`) begins with a trademark symbol. */
export function startsWithSymbol(text: string, index = 0): boolean {
  return SYMBOL_CHARS.has(text.charAt(index));
}

// A mention inside a URL token is not prose ("https://example.com/Docker").
// The left boundary already rules out most of these; this catches the rest.
function insideUrl(text: string, start: number, end: number): boolean {
  let from = start;
  while (from > 0 && !/\s/.test(text.charAt(from - 1))) from--;
  let to = end;
  while (to < text.length && !/\s/.test(text.charAt(to))) to++;
  const token = text.slice(from, to);
  return token.includes("://") || /^www\./i.test(token);
}

/**
 * Every mention in `text`, in order, non-overlapping. Where two candidates
 * overlap, the one that starts first wins, then the longer one.
 */
export function scanMentions(text: string, marks: readonly Trademark[]): Mention[] {
  const c = compile(marks);
  const candidates: Mention[] = [];
  const collect = (re: RegExp | null, index: Map<string, Entry>, fold: boolean) => {
    if (!re) return;
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const entry = index.get(fold ? m[0].toLowerCase() : m[0]);
      if (!entry) continue;
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (insideUrl(text, start, end)) continue;
      candidates.push({
        start,
        end,
        mark: entry.mark,
        trigger: entry.trigger,
        alreadyMarked: startsWithSymbol(text, end),
      });
    }
  };
  collect(c.sensitive, c.sensitiveIndex, false);
  collect(c.insensitive, c.insensitiveIndex, true);
  if (c.sensitive && c.insensitive) {
    candidates.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  }

  const out: Mention[] = [];
  let lastEnd = 0;
  for (const m of candidates) {
    if (m.start < lastEnd) continue;
    out.push(m);
    lastEnd = m.end;
  }
  return out;
}

/**
 * Every mark named in `text` — aliases and triggers — deduped, in order of
 * first appearance. That order is also the order notices list owners in, so
 * the mark a page is about leads its notice.
 */
export function findTrademarks(text: string, marks: readonly Trademark[]): Trademark[] {
  const found: Trademark[] = [];
  const seen = new Set<Trademark>();
  for (const m of scanMentions(text, marks)) {
    if (!seen.has(m.mark)) {
      seen.add(m.mark);
      found.push(m.mark);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Marking
// ---------------------------------------------------------------------------

/**
 * A run of text, plus the mark whose symbol belongs immediately after it.
 * Render as `runs.map((r) => r.text + (r.mark ? r.mark.symbol : ""))`, wrapping
 * the symbol in your own `<span class="tm-symbol">` if you style it.
 */
export interface MarkedRun {
  text: string;
  mark?: Trademark;
}

/**
 * Split `text` after the first mention of each mark not already in `marked`,
 * and add those marks to it. Always returns at least one run; a string with
 * nothing to mark comes back as a single run with no `mark`.
 *
 * `marked` is the page's running state: share one Set across every string a
 * page renders and "first mention on this page" falls out. A mention the text
 * already carries a symbol on ("ClickHouse®") counts as marked and is left
 * alone. Triggers are never marked.
 */
export function markFirstMentions(
  text: string,
  marks: readonly Trademark[],
  marked: Set<Trademark> = new Set()
): MarkedRun[] {
  const runs: MarkedRun[] = [];
  let cursor = 0;
  for (const m of scanMentions(text, marks)) {
    if (m.trigger || marked.has(m.mark)) continue;
    marked.add(m.mark);
    if (m.alreadyMarked) continue;
    runs.push({ text: text.slice(cursor, m.end), mark: m.mark });
    cursor = m.end;
  }
  if (cursor < text.length || runs.length === 0) runs.push({ text: text.slice(cursor) });
  return runs;
}

// ---------------------------------------------------------------------------
// Notices
// ---------------------------------------------------------------------------

/** "a, b, and c" — serial comma. */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/** Terminate a sentence without doubling the period on "…, Inc." */
function endSentence(sentence: string): string {
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

function attachQualifier(owner: string, qualifier: string | undefined): string {
  if (!qualifier) return owner;
  return /^[,;:]/.test(qualifier) ? `${owner}${qualifier}` : `${owner} ${qualifier}`;
}

function sentenceFor(group: Trademark[]): string {
  const first = group[0] as Trademark;
  const names = joinNames(group.map((m) => `${m.name}${m.symbol}`));
  // "registered" only when every mark in the sentence is; otherwise the
  // generic "trademark", which is true of both kinds.
  const registered = group.every((m) => m.symbol === "®") ? "registered " : "";
  const plural = group.length > 1;
  const verb = plural ? `are ${registered}trademarks of` : `is a ${registered}trademark of`;
  let sentence = `${names} ${verb} ${attachQualifier(first.owner ?? "", first.qualifier)}`;
  if (first.licensed === true) {
    sentence += ` and ${plural ? "are" : "is"} used under license`;
  } else if (typeof first.licensed === "string" && first.licensed.trim() !== "") {
    sentence += `, and any use of such ${plural ? "marks" : "mark"} by ${first.licensed.trim()} is under license`;
  }
  return endSentence(sentence);
}

/** One notice: the sentence, plus the distinct links of the marks it covers. */
export interface TrademarkNotice {
  text: string;
  /** Distinct `link`s of the notice's marks, in the sentence's mark order. */
  links: string[];
}

/**
 * One attribution notice per owner, for the marks in `found`, with links kept
 * separate so each output format can render them its own way:
 *
 *   { text: "Kubernetes® and Prometheus® are registered trademarks of The Linux Foundation.", links: [] }
 *
 * - Owners are listed in the order `found` names them; marks inside one
 *   owner's sentence follow `registry` order (default: `found` order), so a
 *   parent brand can lead its own family.
 * - "registered" only when every mark in the sentence is ®.
 * - Marks are grouped by owner AND qualifier AND licensing, so one mark's
 *   "used under license" never leaks onto another mark the site owns outright.
 * - A mark with a verbatim `notice` gets that notice as its own line; marks
 *   sharing an identical notice share one line.
 * - Marks without an `owner` (and no `notice`) produce nothing: the catch-all
 *   covers them, and their `link` is ignored.
 * - Identical links within one notice are listed once.
 */
export function trademarkNoticeEntries(
  found: readonly Trademark[],
  registry: readonly Trademark[] = found
): TrademarkNotice[] {
  const order = new Map<Trademark, number>();
  registry.forEach((m, i) => {
    order.set(m, i);
  });
  const rank = (m: Trademark) => order.get(m) ?? Number.MAX_SAFE_INTEGER;

  const groups = new Map<string, Trademark[]>();
  const unique = [...new Set(found)];
  for (const mark of unique) {
    let key: string;
    // Identical verbatim notices collapse to one line, so several marks can
    // share one owner-mandated sentence.
    if (mark.notice) key = `notice\0${mark.notice}`;
    else if (mark.owner) {
      key = `owner\0${mark.owner}\0${mark.qualifier ?? ""}\0${String(mark.licensed ?? false)}`;
    } else continue;
    const group = groups.get(key);
    if (group) group.push(mark);
    else groups.set(key, [mark]);
  }

  return [...groups.values()].map((group) => {
    const sorted = [...group].sort((a, b) => rank(a) - rank(b));
    const first = sorted[0] as Trademark;
    const links = [...new Set(sorted.flatMap((m) => (m.link === undefined ? [] : [m.link])))];
    return { text: first.notice ?? sentenceFor(sorted), links };
  });
}

/**
 * {@link trademarkNoticeEntries} as plain-text lines, each link appended as a
 * bare URL:
 *
 *   "ClickHouse® is a registered trademark of ClickHouse, Inc. https://clickhouse.com"
 */
export function trademarkNotices(
  found: readonly Trademark[],
  registry: readonly Trademark[] = found
): string[] {
  return trademarkNoticeEntries(found, registry).map((n) => [n.text, ...n.links].join(" "));
}

/** Options for {@link noticesForText}. */
export interface NoticesForTextOptions {
  /** Line appended after the notices when any mark was found. `false` omits it. */
  catchAll?: string | false;
  /**
   * The text is Markdown: strip fenced code blocks and inline code before
   * scanning, and write links as autolinks (`<https://…>`) instead of bare URLs.
   */
  markdown?: boolean;
}

/**
 * Remove fenced code blocks and inline code spans from Markdown, so a mark
 * named only in code does not earn a notice — the same rule the HTML pass
 * applies to `<pre>` and `<code>`.
 */
export function stripMarkdownCode(markdown: string): string {
  const kept: string[] = [];
  let fence: string | null = null;
  for (const line of markdown.split("\n")) {
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence === null) {
      if (open?.[1]) fence = open[1];
      else kept.push(line);
    } else if (open?.[1] && open[1][0] === fence[0] && open[1].length >= fence.length) {
      // A closing fence carries nothing after its run but whitespace.
      if (line.trim() === open[1] || /^[`~]+\s*$/.test(line.trim())) fence = null;
    }
  }
  return kept.join("\n").replace(/(`+)(?!`)[\s\S]*?[^`]\1(?!`)/g, " ");
}

/**
 * Plain-text attribution lines for a string that is not HTML — a `.md` twin,
 * an `llms.txt` — or `[]` when it names no mark. The notices plus, by default,
 * the catch-all line.
 */
export function noticesForText(
  text: string,
  marks: readonly Trademark[],
  options: NoticesForTextOptions = {}
): string[] {
  const source = options.markdown ? stripMarkdownCode(text) : text;
  const found = findTrademarks(source, marks);
  if (found.length === 0) return [];
  const lines = trademarkNoticeEntries(found, marks).map((n) =>
    [n.text, ...n.links.map((url) => (options.markdown ? `<${url}>` : url))].join(" ")
  );
  const catchAll = options.catchAll === undefined ? DEFAULT_CATCH_ALL : options.catchAll;
  if (catchAll) lines.push(catchAll);
  return lines;
}
