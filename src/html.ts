// The HTML engine: one pass over a rendered page that marks the first mention
// of each mark inside the content root(s) and fills the notices placeholder
// with notices for exactly the marks that same pass found.
//
// It edits the page surgically. parse5 builds a spec-compliant tree with
// source offsets; every change is an insertion or replacement at an offset in
// the ORIGINAL string, so everything the pass does not touch comes out
// byte-identical — no re-serialisation, no reformatted attributes, and a page
// that names no mark is returned unchanged.

import { decodeHTML, escapeText } from "entities";
import { parse, type DefaultTreeAdapterTypes as T } from "parse5";
import { scanMentions, startsWithSymbol, type Trademark, trademarkNotices } from "./core.ts";

/** Elements whose text is never marked. Spec default; see README. */
export const DEFAULT_SKIP_TAGS: readonly string[] = [
  // Astro collects heading text for the table of contents before the page
  // renders, so a symbol in a heading would desync the heading from its entry.
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  // A symbol inside a copy-pasteable command or identifier is a bug.
  "code",
  "pre",
  "kbd",
  "samp",
  "var",
  // Rendered diagrams and math.
  "svg",
  "math",
  // Control labels, not prose.
  "button",
  "select",
];

/** Classes whose subtree is never marked: rendered math and code-block chrome. */
export const DEFAULT_SKIP_CLASSES: readonly string[] = ["katex", "expressive-code"];

/**
 * Added by the `starlight` preset. Control labels (link buttons and cards),
 * the aria-hidden aside title, prev/next links (other pages' titles), and the
 * heading anchor link: Starlight renders it as a sibling of the heading, not
 * inside it, with a screen-reader label that repeats the heading text — marking
 * that would reintroduce the heading/TOC desync the heading rule prevents.
 */
export const STARLIGHT_SKIP_CLASSES: readonly string[] = [
  "sl-link-button",
  "sl-link-card",
  "starlight-aside__title",
  "sl-anchor-link",
  "pagination-links",
];

// Raw-text and inert containers: never read at all, not even for a symbol
// someone typed by hand.
const RAW_TAGS = new Set(["script", "style", "template", "textarea", "noscript", "title"]);

/** Attribute that marks the notices placeholder (rendered by the component). */
export const PLACEHOLDER_ATTR = "data-tm-notices";
/** Attribute on the element inside the placeholder that receives the notices. */
export const SLOT_ATTR = "data-tm-slot";
/** Attribute that opts an element's subtree out of marking. */
export const SKIP_ATTR = "data-tm-skip";

/** Options for {@link transformHtml}. */
export interface TransformHtmlOptions {
  /** The site's registry. */
  marks: readonly Trademark[];
  /**
   * Compound selectors for the element(s) whose text is scanned and marked.
   * Default `["main"]`. Supported syntax: `tag`, `.class`, `#id`, `[attr]`,
   * `[attr=value]`, combined without spaces (`div.content[data-x]`); no
   * combinators or pseudo-classes.
   */
  contentRoots?: readonly string[];
  /** Tags never marked, replacing {@link DEFAULT_SKIP_TAGS}. */
  skipTags?: readonly string[];
  /** Classes never marked, replacing {@link DEFAULT_SKIP_CLASSES}. */
  skipClasses?: readonly string[];
  /** Class on the inserted `<span>`. Default `"tm-symbol"`. */
  symbolClass?: string;
}

/** What {@link transformHtml} did to a page. */
export interface TransformHtmlResult {
  /** The page, or the input string itself when nothing changed. */
  html: string;
  /** Every mark the pass found, in order of first appearance. */
  found: Trademark[];
  /** The notices written into the placeholder(s). */
  notices: string[];
  /** Whether `html` differs from the input. */
  changed: boolean;
}

// ---------------------------------------------------------------------------
// Compound selectors
// ---------------------------------------------------------------------------

interface Compound {
  tag?: string;
  ids: string[];
  classes: string[];
  attrs: { name: string; value?: string }[];
}

const SELECTOR_PART =
  /([a-zA-Z][\w-]*|\*)|#([\w-]+)|\.([\w-]+)|\[\s*([\w:-]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+))\s*)?\]/y;

/** Parse a comma-separated list of compound selectors. Throws on anything else. */
export function parseSelectors(list: readonly string[]): Compound[] {
  const out: Compound[] = [];
  for (const raw of list.flatMap((s) => s.split(","))) {
    const sel = raw.trim();
    if (!sel) continue;
    const c: Compound = { ids: [], classes: [], attrs: [] };
    let i = 0;
    while (i < sel.length) {
      SELECTOR_PART.lastIndex = i;
      const m = SELECTOR_PART.exec(sel);
      if (!m) {
        throw new TypeError(
          `[astro-trademarks] unsupported selector "${sel}": only compound selectors (tag, .class, #id, [attr], [attr=value]) are supported.`
        );
      }
      if (m[1]) {
        if (i !== 0) throw new TypeError(`[astro-trademarks] tag must lead the selector: "${sel}"`);
        if (m[1] !== "*") c.tag = m[1].toLowerCase();
      } else if (m[2]) c.ids.push(m[2]);
      else if (m[3]) c.classes.push(m[3]);
      else if (m[4]) c.attrs.push({ name: m[4].toLowerCase(), value: m[5] ?? m[6] ?? m[7] });
      i = SELECTOR_PART.lastIndex;
    }
    out.push(c);
  }
  return out;
}

function attr(el: T.Element, name: string): string | undefined {
  return el.attrs.find((a) => a.name === name)?.value;
}

function classList(el: T.Element): string[] {
  return (attr(el, "class") ?? "").split(/\s+/).filter(Boolean);
}

function matches(el: T.Element, selectors: Compound[]): boolean {
  return selectors.some((c) => {
    if (c.tag && el.tagName !== c.tag) return false;
    if (c.ids.length && !c.ids.every((id) => attr(el, "id") === id)) return false;
    if (c.classes.length) {
      const own = classList(el);
      if (!c.classes.every((k) => own.includes(k))) return false;
    }
    return c.attrs.every((a) => {
      const v = attr(el, a.name);
      return v !== undefined && (a.value === undefined || v === a.value);
    });
  });
}

// ---------------------------------------------------------------------------
// Entity-aware offsets
// ---------------------------------------------------------------------------

const ENTITY = /&(?:#[0-9]+;?|#[xX][0-9a-fA-F]+;?|[A-Za-z][A-Za-z0-9]*;?)/y;

/**
 * Decode a raw text slice the way the parser did, recording for each decoded
 * UTF-16 unit the raw offset just after it. That is what lets a match found in
 * decoded text become an insertion point in the source.
 */
function decodeWithOffsets(raw: string): { text: string; ends: number[] } {
  if (!raw.includes("&") && !raw.includes("\r")) {
    return { text: raw, ends: Array.from({ length: raw.length }, (_, i) => i + 1) };
  }
  let text = "";
  const ends: number[] = [];
  let i = 0;
  while (i < raw.length) {
    const ch = raw.charAt(i);
    if (ch === "&") {
      ENTITY.lastIndex = i;
      const m = ENTITY.exec(raw);
      if (m) {
        const decoded = decodeHTML(m[0]);
        const end = i + m[0].length;
        for (let k = 0; k < decoded.length; k++) ends.push(end);
        text += decoded;
        i = end;
        continue;
      }
    }
    if (ch === "\r") {
      const end = raw.charAt(i + 1) === "\n" ? i + 2 : i + 1;
      text += "\n";
      ends.push(end);
      i = end;
      continue;
    }
    text += ch;
    ends.push(i + 1);
    i++;
  }
  return { text, ends };
}

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

/**
 * `mark`: new symbols may be inserted. `skip`: no new symbols, but a mention
 * that already carries one counts. `raw`: not read at all.
 */
type Mode = "mark" | "skip" | "raw";

interface TextItem {
  node: T.TextNode;
  mode: Mode;
}

interface Placeholder {
  el: T.Element;
  slot?: T.Element;
}

interface Edit {
  start: number;
  end: number;
  text: string;
}

function isElement(node: T.ChildNode): node is T.Element {
  return "tagName" in node;
}

/**
 * Mark the first mention of each mark inside the content root(s) of `html`
 * and fill every notices placeholder with notices for the marks found.
 *
 * - A placeholder on a page with no marks found is removed, title and all.
 * - Marks found but none with an owner: the placeholder keeps its catch-all.
 * - No placeholder: the content is still marked.
 */
export function transformHtml(html: string, options: TransformHtmlOptions): TransformHtmlResult {
  const { marks } = options;
  const roots = parseSelectors(options.contentRoots ?? ["main"]);
  const skipTags = new Set((options.skipTags ?? DEFAULT_SKIP_TAGS).map((t) => t.toLowerCase()));
  const skipClasses = new Set(options.skipClasses ?? DEFAULT_SKIP_CLASSES);
  const symbolClass = options.symbolClass ?? "tm-symbol";

  const doc = parse(html, { sourceCodeLocationInfo: true });
  const items: TextItem[] = [];
  const placeholders: Placeholder[] = [];

  const isSkipped = (el: T.Element) =>
    skipTags.has(el.tagName) ||
    classList(el).some((c) => skipClasses.has(c)) ||
    attr(el, SKIP_ATTR) !== undefined ||
    attr(el, "aria-hidden") === "true" ||
    attr(el, "hidden") !== undefined;

  // `resume` is the mode to return to inside an <astro-slot>: an island's own
  // markup is re-rendered by its framework on hydration (a symbol there would
  // be a hydration mismatch), but slotted children are static server HTML.
  const walk = (parent: T.ParentNode, mode: Mode, inRoot: boolean, resume: Mode) => {
    for (const child of parent.childNodes) {
      if (child.nodeName === "#text") {
        if (inRoot) items.push({ node: child as T.TextNode, mode });
        continue;
      }
      if (!isElement(child)) continue;
      const el = child;

      if (attr(el, PLACEHOLDER_ATTR) !== undefined) {
        placeholders.push({ el, slot: findSlot(el) });
        continue;
      }
      const enters = !inRoot && matches(el, roots);
      let next: Mode = mode;
      let nextResume = resume;
      if (RAW_TAGS.has(el.tagName)) next = "raw";
      else if (mode !== "raw") {
        if (el.tagName === "astro-island") {
          nextResume = mode;
          next = "skip";
        } else if (el.tagName === "astro-slot") {
          next = resume;
        }
        if (isSkipped(el)) {
          next = "skip";
          nextResume = "skip";
        }
      }
      walk(el, next, inRoot || enters, nextResume);
    }
  };
  walk(doc, "mark", false, "mark");

  // ---- scan --------------------------------------------------------------
  const found: Trademark[] = [];
  const foundSet = new Set<Trademark>();
  const marked = new Set<Trademark>();
  const edits: Edit[] = [];
  const addFound = (mark: Trademark) => {
    if (!foundSet.has(mark)) {
      foundSet.add(mark);
      found.push(mark);
    }
  };

  const nextTextStartsWithSymbol = (index: number) => {
    for (let j = index + 1; j < items.length; j++) {
      const item = items[j] as TextItem;
      if (item.mode === "raw") continue;
      return startsWithSymbol(item.node.value);
    }
    return false;
  };

  items.forEach((item, index) => {
    if (item.mode === "raw") return;
    const loc = item.node.sourceCodeLocation;
    if (!loc) return;
    const { text, ends } = decodeWithOffsets(html.slice(loc.startOffset, loc.endOffset));
    // If our decoding disagrees with the parser's, we cannot place a symbol
    // safely — leave the node alone entirely, so it is neither marked nor
    // counted (a notice with no symbol is the bug this package exists to fix).
    if (text !== item.node.value) return;

    for (const m of scanMentions(text, marks)) {
      if (m.trigger) {
        if (item.mode === "mark") addFound(m.mark);
        continue;
      }
      const already = m.alreadyMarked || (m.end === text.length && nextTextStartsWithSymbol(index));
      if (already) {
        addFound(m.mark);
        marked.add(m.mark);
        continue;
      }
      if (item.mode !== "mark") continue;
      addFound(m.mark);
      if (marked.has(m.mark)) continue;
      marked.add(m.mark);
      const at = loc.startOffset + (ends[m.end - 1] as number);
      edits.push({
        start: at,
        end: at,
        text: `<span class="${escapeText(symbolClass)}">${m.mark.symbol}</span>`,
      });
    }
  });

  // ---- notices -----------------------------------------------------------
  const notices = trademarkNotices(found, marks);
  for (const { el, slot } of placeholders) {
    const loc = el.sourceCodeLocation;
    if (!loc) continue;
    if (found.length === 0) {
      edits.push({ start: loc.startOffset, end: loc.endOffset, text: "" });
      continue;
    }
    const body = notices.length
      ? `${notices.map((n) => `<span class="tm-notice">${escapeText(n)}</span>`).join(" ")} `
      : "";
    const target = slot?.sourceCodeLocation;
    if (target?.startTag && target.endTag) {
      edits.push({ start: target.startTag.endOffset, end: target.endTag.startOffset, text: body });
    } else if (loc.startTag) {
      edits.push({ start: loc.startTag.endOffset, end: loc.startTag.endOffset, text: body });
    }
  }

  if (edits.length === 0) return { html, found, notices, changed: false };
  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  let out = html;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return { html: out, found, notices, changed: out !== html };
}

function findSlot(el: T.Element): T.Element | undefined {
  for (const child of el.childNodes) {
    if (!isElement(child)) continue;
    if (attr(child, SLOT_ATTR) !== undefined) return child;
    const deeper = findSlot(child);
    if (deeper) return deeper;
  }
  return undefined;
}
