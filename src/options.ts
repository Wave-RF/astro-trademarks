// Integration options, their defaults, and resolution to the plain-data shape
// the middleware receives through a virtual module.

import { DEFAULT_CATCH_ALL, defineTrademarks, type Trademark } from "./core.ts";
import {
  DEFAULT_SKIP_CLASSES,
  DEFAULT_SKIP_TAGS,
  parseSelectors,
  STARLIGHT_SKIP_CLASSES,
} from "./html.ts";

/** Named bundles of extra skip rules. */
export type TrademarksPreset = "starlight";

/** Options for the `trademarks()` integration. */
export interface TrademarksOptions {
  /** The site's registry. Nothing ships by default; see `defineTrademarks()`. */
  marks: readonly Trademark[];
  /**
   * Compound selectors for the element(s) whose text is scanned and marked.
   * Default `["main"]`.
   */
  contentRoots?: readonly string[];
  /**
   * Presets of extra skip rules. Default: `["starlight"]` when the
   * `@astrojs/starlight` integration is present, otherwise `[]`.
   */
  presets?: readonly TrademarksPreset[];
  /** Extra tags never marked, ADDED to the defaults. */
  skipTags?: readonly string[];
  /** Extra classes never marked, ADDED to the defaults (and any preset's). */
  skipClasses?: readonly string[];
  /** Class on the inserted symbol `<span>`. Default `"tm-symbol"`. */
  symbolClass?: string;
  /**
   * `target` for notice links (a mark's `link`). Default `"_self"`: no
   * `target` attribute, the link opens in the same tab like any other link.
   * `"_blank"` opens a new tab. Links always carry `rel="noopener noreferrer"`.
   */
  linkTarget?: "_self" | "_blank";
  /**
   * Inject the package's `styles.css` (the `.tm-symbol` superscript rule) on
   * every page. Default `true`. Set `false` to style `.tm-symbol` yourself.
   */
  injectStyles?: boolean;
  /**
   * Process on-demand (server-rendered) pages too. Default `true`. Marking
   * needs the whole page, so an on-demand HTML response is buffered rather
   * than streamed; set `false` to touch prerendered pages only.
   */
  onDemand?: boolean;
  /**
   * Append plain-text attribution to machine-readable responses. Off by
   * default — those copies stay small and byte-identical unless you opt in.
   */
  machineReadable?: {
    /** Append to `text/markdown` responses. Default `false`. */
    markdown?: boolean;
    /** Append to `text/plain` responses (e.g. `llms.txt`). Default `false`. */
    plain?: boolean;
    /** Catch-all line after the notices; `false` omits it. Default {@link DEFAULT_CATCH_ALL}. */
    catchAll?: string | false;
  };
}

/** Fully-resolved, JSON-serialisable options the middleware runs with. */
export interface ResolvedTrademarksOptions {
  marks: Trademark[];
  contentRoots: string[];
  skipTags: string[];
  skipClasses: string[];
  symbolClass: string;
  linkTarget: "_self" | "_blank";
  onDemand: boolean;
  machineReadable: { markdown: boolean; plain: boolean; catchAll: string | false };
}

/** Apply defaults and validate. `starlightDetected` picks the default preset. */
export function resolveOptions(
  options: TrademarksOptions,
  starlightDetected = false
): ResolvedTrademarksOptions {
  if (!options || !Array.isArray(options.marks)) {
    throw new TypeError("[astro-trademarks] `marks` is required: pass your site's registry.");
  }
  const marks = [...defineTrademarks(options.marks)];
  const contentRoots = [...(options.contentRoots ?? ["main"])];
  parseSelectors(contentRoots); // throws early, at config time, on bad syntax
  const presets = options.presets ?? (starlightDetected ? ["starlight"] : []);
  const unique = (xs: string[]) => [...new Set(xs)];
  return {
    marks,
    contentRoots,
    skipTags: unique(
      [...DEFAULT_SKIP_TAGS, ...(options.skipTags ?? [])].map((t) => t.toLowerCase())
    ),
    skipClasses: unique([
      ...DEFAULT_SKIP_CLASSES,
      ...(presets.includes("starlight") ? STARLIGHT_SKIP_CLASSES : []),
      ...(options.skipClasses ?? []),
    ]),
    symbolClass: options.symbolClass ?? "tm-symbol",
    linkTarget: options.linkTarget === "_blank" ? "_blank" : "_self",
    onDemand: options.onDemand ?? true,
    machineReadable: {
      markdown: options.machineReadable?.markdown ?? false,
      plain: options.machineReadable?.plain ?? false,
      catchAll:
        options.machineReadable?.catchAll === undefined
          ? DEFAULT_CATCH_ALL
          : options.machineReadable.catchAll,
    },
  };
}
