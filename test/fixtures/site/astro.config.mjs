import mdx from "@astrojs/mdx";
import node from "@astrojs/node";
import trademarks from "@wave-rf/astro-trademarks";
import { defineConfig } from "astro/config";
import marks from "./marks.mjs";

export default defineConfig({
  adapter: node({ mode: "standalone" }),
  integrations: [mdx(), trademarks({ marks })],
});
