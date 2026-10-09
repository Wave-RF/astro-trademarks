# @wave-rf/astro-trademarks

Marks the **first mention** of each third-party trademark on a page with ® or ™, and renders **that page's** trademark notices — only for the marks the page actually shows with a symbol.

Works the same for `.astro`, Markdown, MDX and Starlight pages, because it runs once over the rendered HTML (as Astro middleware) rather than inside one content pipeline.

```html
<!-- you write -->
<main><p>We run ClickHouse in production. ClickHouse is fast.</p></main>
<footer><TrademarkNotices /></footer>

<!-- the page ships -->
<main><p>We run ClickHouse<span class="tm-symbol">®</span> in production. ClickHouse is fast.</p></main>
<footer>
  <div class="tm-notices" data-tm-notices>
    <p class="tm-notices__body">
      <span class="tm-notices__list" data-tm-slot><span class="tm-notice">ClickHouse® is a registered trademark of ClickHouse, Inc.</span> </span>
      <span class="tm-notices__catch-all">All other trademarks are the property of their respective owners.</span>
    </p>
  </div>
</footer>
```

> **Not legal advice.** This package ships **no list of marks** and makes no claims about anyone's trademarks. Your site supplies its own registry, and whether a mark is registered, who owns it, and what wording its owner asks for are claims *your site* makes. Have counsel review the registry before relying on it.

## Why one pass over the HTML

The notices and the symbols come from **the same scan of the same rendered page**. A notice can only appear for a mark that got a symbol (or was named through a [trigger](#the-registry)), so a page never carries a notice for a mark it shows only in a code block or a heading. Pages that name no mark lose the notices block entirely.

## Install

```sh
pnpm add @wave-rf/astro-trademarks
```

Requires Astro 6 or 7 (`peerDependencies.astro >= 6`) and Node ≥ 22.12.

## Quick start

**1. Write your registry** — e.g. `src/trademarks.ts`. (The entries below are illustrative; verify every symbol, owner and wording against the owner's own guidance.)

```ts
import { defineTrademarks } from "@wave-rf/astro-trademarks";

export default defineTrademarks([
  {
    name: "ClickHouse",
    symbol: "®",
    owner: "ClickHouse, Inc.",
    source: "https://example.com/owner-trademark-guidelines", // for audits
  },
  {
    name: "Grafana Loki",
    aliases: ["Grafana Loki", "Loki"], // both are marked; the longer match wins
    symbol: "™",
    owner: "Grafana Labs",
  },
  {
    name: "Bluetooth",
    symbol: "®",
    owner: "Bluetooth SIG, Inc.",
    triggers: ["BLE"], // "BLE" makes the notice relevant but is never marked
    licensed: "Example Corp.",
  },
]);
```

**2. Add the integration** in `astro.config.mjs`:

```js
import { defineConfig } from "astro/config";
import trademarks from "@wave-rf/astro-trademarks";
import marks from "./src/trademarks.ts";

export default defineConfig({
  integrations: [trademarks({ marks })],
});
```

**3. Render the notices** where you want them, typically your footer:

```astro
---
import TrademarkNotices from "@wave-rf/astro-trademarks/TrademarkNotices.astro";
---
<footer>
  <TrademarkNotices
    title="Trademark notices"
    disclaimer="Example Corp. is not affiliated with, endorsed by, or sponsored by the trademark holders named above."
  />
</footer>
```

That's it. Every `text/html` response is marked; the `.tm-symbol` style is injected for you.

### Starlight

Same three steps. The `starlight` preset turns on automatically when `@astrojs/starlight` is in your integrations. To render notices, [override the `Footer` component](https://starlight.astro.build/guides/overriding-components/):

```astro
---
// src/components/Footer.astro
import Default from "@astrojs/starlight/components/Footer.astro";
import TrademarkNotices from "@wave-rf/astro-trademarks/TrademarkNotices.astro";
---
<Default />
<TrademarkNotices />
```

```js
starlight({ title: "Docs", components: { Footer: "./src/components/Footer.astro" } }),
trademarks({ marks }),
```

Starlight renders its footer inside `<main>`. That's fine: the notices block is never scanned itself.

## The registry

```ts
interface Trademark {
  name: string;                 // as the notice names it: "Apache Kafka"
  aliases?: string[];           // marked spellings; default [name]; longest match wins
  triggers?: string[];          // count toward notices but are never marked ("BLE")
  symbol: "®" | "™";
  owner?: string;               // legal owner, verbatim; omit when unverified
  qualifier?: string;           // "in the U.S. and other countries"
  notice?: string;              // verbatim notice, replaces the generated sentence
  licensed?: boolean | string;  // "used under license"; a string names the licensee
  caseSensitive?: boolean;      // default true
  source?: string;              // URL of the owner's guidance, for audits; never rendered
}
```

`defineTrademarks()` returns the array unchanged, typed, and validated: it throws on a symbol other than ® / ™, an empty alias or trigger, or one spelling claimed by two marks.

Conservative defaults worth keeping:

- **® only where the owner's own guidance says the mark is registered.** ™ is the safe default: ™ on a registered mark is harmless; ® on an unregistered one is a false claim.
- **`owner` is optional.** A mark with no verified owner still gets its symbol and is covered by the catch-all line, rather than by a notice naming the wrong company.
- **`caseSensitive` defaults to `true`.** "Thread" the protocol is not "thread" the noun. Set it `false` only for marks that are never also a common word — and remember a case-sensitive mark still matches at the start of a sentence ("Thread pools are…").

### Matching

- **Boundaries.** A mention can't be part of a larger word: not preceded by a letter, digit or `_`, and not followed by one. `ClickHouse-backed` and `ClickHouse's` match; `ClickHouseDB` doesn't. Works for marks that end in punctuation (`Node.js` matches `Node.js,` but not `Node.jsx`).
- **Not prose:** a mention preceded by `/ . @ # \` (a path, domain, handle or anchor: `github.com/ClickHouse`, `@Docker`), followed by `.` or `@` and a letter (`ClickHouse.com`), or inside a token that contains `://` or starts with `www.`.
- **Longest alias wins** at a position, so `Grafana Loki` beats `Grafana`.
- **Symbols already on the page count.** `ClickHouse®`, `ClickHouse&reg;` and `ClickHouse<sup>®</sup>` are treated as the marked first mention: nothing is doubled, and the mark gets its notice. This holds even inside skipped elements, such as a hand-marked heading, because the reader sees the symbol.

### Notice wording

One sentence per owner, owners in the order the page names them, marks inside one sentence in registry order:

| Marks found | Notice |
|---|---|
| ClickHouse ® | ClickHouse® is a registered trademark of ClickHouse, Inc. |
| Grafana ®, Grafana Loki ™ | Grafana® and Grafana Loki™ are trademarks of Grafana Labs. |
| + `qualifier: "in the U.S. and other countries"` | … of Owner in the U.S. and other countries. |
| + `qualifier: ", registered in the U.S. and other countries"` | … of Owner, registered in the U.S. and other countries. |
| + `licensed: true` | … of Owner and is used under license. |
| + `licensed: "Example Corp."` | … of Owner, and any use of such mark by Example Corp. is under license. |
| + `notice: "…"` | the notice, verbatim, on its own line |

- "registered" appears only when **every** mark in the sentence is ®; otherwise the sentence says "trademarks", which is true of both.
- Marks are grouped by owner **and** qualifier **and** licensing, so one mark's "used under license" never attaches to another mark of the same owner.
- A mark with `notice` is never merged into another mark's sentence. Marks that carry the **same** `notice` string share one line, which is how a family of marks gets one owner-mandated sentence.
- Marks without an `owner` produce no sentence. The catch-all covers them.

## Options

```js
trademarks({
  marks,                         // required
  contentRoots: ["main"],        // where to mark
  presets: undefined,            // default: ["starlight"] if Starlight is present, else []
  skipTags: [],                  // ADDED to the default skip tags
  skipClasses: [],               // ADDED to the default skip classes
  symbolClass: "tm-symbol",
  injectStyles: true,            // inject styles.css on every page
  onDemand: true,                // also process server-rendered pages
  machineReadable: { markdown: false, plain: false, catchAll: "All other trademarks are the property of their respective owners." },
})
```

| Option | Default | |
|---|---|---|
| `contentRoots` | `["main"]` | Compound selectors (`tag`, `.class`, `#id`, `[attr]`, `[attr=value]`, combined without spaces). The page's text outside them is neither marked nor counted. Combinators are rejected at config time. |
| `presets` | auto | `"starlight"` adds the skip classes listed below. |
| `skipTags` / `skipClasses` | `[]` | Added to the defaults. |
| `symbolClass` | `"tm-symbol"` | Class on the inserted `<span>`. |
| `injectStyles` | `true` | Injects `@wave-rf/astro-trademarks/styles.css`. Set `false` and import it yourself, or style `.tm-symbol` your own way. |
| `onDemand` | `true` | Marking needs the whole page, so an on-demand HTML response is **buffered** before it is sent (prerendered pages are unaffected). Set `false` to process prerendered pages only. |
| `machineReadable.markdown` | `false` | Append attribution to `text/markdown` responses (fenced and inline code are ignored when scanning). |
| `machineReadable.plain` | `false` | Append attribution to `text/plain` responses, e.g. `llms.txt`. |
| `machineReadable.catchAll` | the catch-all | `false` omits it from appended attribution. |

By default `text/markdown` and `text/plain` responses are **not touched**, byte for byte. Every other content type passes through unchanged.

### What is never marked

| | Why |
|---|---|
| `h1`–`h6` | Astro builds the table of contents from heading text before the page renders, so a symbol in a heading would desync the heading from its TOC entry. |
| `code`, `pre`, `kbd`, `samp`, `var` | A symbol inside a command or identifier is a bug. |
| `svg`, `math`, `.katex`, `.expressive-code` | Rendered diagrams, math and code-block chrome. |
| `button`, `select` | Control labels, not prose. |
| `[aria-hidden="true"]`, `[hidden]` | Using the page's one marking on text a screen reader skips, or nobody sees, means the reader never gets it. |
| `[data-tm-skip]` | Your opt-out for any element. |
| `<astro-island>` markup | A framework island re-renders on hydration, so a symbol there would be a hydration mismatch. Slotted children (`<astro-slot>`) are static server HTML and **are** marked. |
| `script`, `style`, `template`, `textarea`, `noscript`, `title` | Not read at all. |
| **starlight preset:** `.sl-link-button`, `.sl-link-card`, `.starlight-aside__title`, `.sl-anchor-link`, `.pagination-links` | Link labels, the aria-hidden aside title, the heading anchor's "Section titled …" label (which repeats the heading), and prev/next page titles. |

Skipped elements never *receive* a symbol and don't count a bare mention. As noted under [Matching](#matching), a symbol already typed there still counts.

## `<TrademarkNotices />`

| Prop | Default | |
|---|---|---|
| `title` | — | A heading line. Omitted when unset. |
| `catchAll` | "All other trademarks are the property of their respective owners." | `false` omits it. |
| `disclaimer` | — | Your own statement, e.g. non-affiliation. Omitted when unset. |
| `as` | `"div"` | `"div" \| "aside" \| "section" \| "footer"` |
| `class` | — | Extra classes on the wrapper. |

Behaviour, all decided by the middleware:

- **Marks found, some with an owner** → the notices, then the catch-all and disclaimer.
- **Marks found, none with an owner** → the catch-all and disclaimer. The block is gated on *marks found*, not on notices, because the catch-all is what covers an ownerless mark.
- **No mark found** → the whole block, title included, is removed.
- **More than one `<TrademarkNotices />`** → each is filled.
- **No `<TrademarkNotices />`** → the content is still marked.
- **Middleware not running** (e.g. the integration is missing) → the shell renders with the catch-all and disclaimer and no notices. That's the conservative failure.

### Styling

Everything is CSS custom properties, at zero specificity (`:where`), with no Tailwind or Starlight assumptions:

| Variable | Default |
|---|---|
| `--tm-notices-font-size` | `0.75rem` |
| `--tm-notices-line-height` | `1.5` |
| `--tm-notices-color` | `inherit` |
| `--tm-notices-gap` | `0.5em` (between title, body and disclaimer) |
| `--tm-notices-title-font-weight` | `600` |
| `--tm-notices-title-color` | `inherit` |
| `--tm-notices-disclaimer-color` | `inherit` |
| `--tm-notice-display` | `inline` (set `block` for one notice per line) |
| `--tm-symbol-font-size` | `0.62em` |
| `--tm-symbol-offset` | `0.45em` (the symbol's `vertical-align`) |

Class hooks: `.tm-notices`, `.tm-notices__title`, `.tm-notices__body`, `.tm-notices__list`, `.tm-notice`, `.tm-notices__catch-all`, `.tm-notices__disclaimer`, `.tm-symbol`.

## The pure core

`@wave-rf/astro-trademarks/core` has no Astro or DOM imports. Use it for text that isn't a rendered HTML page.

```ts
import {
  findTrademarks,      // (text, marks) => Trademark[]  — every mark named, aliases + triggers, first-appearance order
  markFirstMentions,   // (text, marks, marked?: Set) => { text, mark? }[]
  trademarkNotices,    // (found, registry?) => string[]  — one sentence per owner
  noticesForText,      // (text, marks, { catchAll?, markdown? }) => string[]
  DEFAULT_CATCH_ALL,
} from "@wave-rf/astro-trademarks/core";
```

**A component that renders its own text** outside the content root, say a header tagline:

```astro
---
import { markFirstMentions } from "@wave-rf/astro-trademarks/core";
import marks from "../trademarks";
const runs = markFirstMentions(Astro.props.tagline, marks);
---
<p>{runs.map((r) => <>{r.text}{r.mark && <span class="tm-symbol">{r.mark.symbol}</span>}</>)}</p>
```

Text *inside* the content root needs none of this: the middleware handles it, and it respects a symbol a component already rendered.

**A `.md` twin or `llms.txt` generator** that wants a one-line attribution:

```ts
import { noticesForText } from "@wave-rf/astro-trademarks/core";
const lines = noticesForText(markdown, marks, { markdown: true });
const out = lines.length ? `${markdown}\n\n${lines.join(" ")}\n` : markdown;
```

Or let the middleware do it with `machineReadable`.

Lower-level exports from the main entry: `transformHtml(html, options)` (the HTML pass on its own, e.g. for a post-build script), `transformResponse`, `createTrademarksMiddleware` (to compose into your own `src/middleware.ts` instead of using the integration), `resolveOptions`, `DEFAULT_SKIP_TAGS`, `DEFAULT_SKIP_CLASSES`, `STARLIGHT_SKIP_CLASSES`.

## How it works, and its limits

- **Middleware, registered with `addMiddleware` (order `pre`).** It runs for prerendered pages during `astro build`, for every page in `astro dev`, and for on-demand pages at request time. This was verified with real builds on Astro 6.4 and 7.3, with and without Starlight.
- **Surgical edits.** The page is parsed with [parse5](https://github.com/inikulin/parse5) for structure and source offsets. Symbols and notices are inserted at offsets in the *original* string. Everything else stays byte-identical, and a page with nothing to change is returned as-is.
- **Streaming.** For an on-demand page, the middleware reads the whole response before sending it, so that page loses progressive streaming. Use `onDemand: false` if that matters more than marking those pages.
- **View transitions (`<ClientRouter />`).** The router fetches the next page as ordinary HTML, so each page arrives already marked with its own notices. **Don't put `<TrademarkNotices />` or your content root inside a `transition:persist` element.** A persisted element keeps the *previous* page's DOM, and with it the previous page's notices.
- **Content roots** take compound selectors only. Anything you want marked must be inside one. Text outside every root, such as a nav bar, site header or `<title>`, is neither marked nor counted.
- **A word split across elements** (`Click<b>House</b>`) is not a mention.
- **No rehype/remark plugin.** One HTML-level pass is the only path, so `.astro`, Markdown and MDX behave identically.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). License: [MIT](LICENSE).
