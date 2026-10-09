// `@wave-rf/astro-trademarks` — the Astro integration, plus re-exports of the
// pure core for code that is not HTML.

import type { AstroIntegration } from "astro";
import { resolveOptions, type TrademarksOptions } from "./options.ts";

const NAME = "@wave-rf/astro-trademarks";
const VIRTUAL_ID = "virtual:@wave-rf/astro-trademarks/config";
const RESOLVED_VIRTUAL_ID = `\0${VIRTUAL_ID}`;

/**
 * The integration. Registers a middleware that, on every `text/html`
 * response, marks the first mention of each mark inside the content root(s)
 * and fills the `<TrademarkNotices />` placeholder with notices for exactly
 * the marks it found.
 */
export default function trademarks(options: TrademarksOptions): AstroIntegration {
  return {
    name: NAME,
    hooks: {
      "astro:config:setup": ({ config, addMiddleware, updateConfig, injectScript }) => {
        const starlight = config.integrations.some((i) => i.name === "@astrojs/starlight");
        const resolved = resolveOptions(options, starlight);
        updateConfig({
          vite: {
            plugins: [
              {
                name: `${NAME}:config`,
                resolveId(id: string) {
                  return id === VIRTUAL_ID ? RESOLVED_VIRTUAL_ID : undefined;
                },
                load(id: string) {
                  return id === RESOLVED_VIRTUAL_ID
                    ? `export default ${JSON.stringify(resolved)};`
                    : undefined;
                },
              },
            ],
            // The middleware imports the virtual module above, so Vite must
            // bundle this package rather than hand it to Node as an external.
            ssr: { noExternal: [NAME] },
          },
        });
        addMiddleware({ entrypoint: new URL("./middleware.js", import.meta.url), order: "pre" });
        if (options.injectStyles !== false) {
          injectScript("page-ssr", `import "${NAME}/styles.css";`);
        }
      },
    },
  };
}

export * from "./core.ts";
export { createTrademarksMiddleware, transformResponse } from "./handler.ts";
export {
  DEFAULT_SKIP_CLASSES,
  DEFAULT_SKIP_TAGS,
  STARLIGHT_SKIP_CLASSES,
  type TransformHtmlOptions,
  type TransformHtmlResult,
  transformHtml,
} from "./html.ts";
export type { ResolvedTrademarksOptions, TrademarksOptions, TrademarksPreset } from "./options.ts";
export { resolveOptions } from "./options.ts";
export { trademarks };
