import starlight from "@astrojs/starlight";
import trademarks from "@wave-rf/astro-trademarks";
import { defineConfig } from "astro/config";
import marks from "./marks.mjs";

export default defineConfig({
  integrations: [
    starlight({
      title: "Fixture docs",
      components: { Footer: "./src/components/Footer.astro" },
      sidebar: [{ label: "Guide", link: "/guide/" }],
    }),
    // No `presets`: the starlight preset is picked up automatically.
    trademarks({ marks }),
  ],
});
