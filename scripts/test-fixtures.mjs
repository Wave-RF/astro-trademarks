#!/usr/bin/env node
// Integration tests against REAL Astro builds: packs this package, installs the
// tarball into fixture sites for each Astro major (and Starlight), runs
// `astro build`, `astro dev` and the on-demand server, and checks the HTML
// that comes out.
//
//   pnpm run test:fixtures                 # every variant
//   pnpm run test:fixtures -- astro7       # only variants whose name matches
//   KEEP=1 pnpm run test:fixtures          # keep the temp dirs for inspection
//
// Slow (network + several builds), so it is not part of `pnpm test`.

import { execFileSync, spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  checkSitePage,
  checkStarlight,
  SITE_EXPECTATIONS,
  STARLIGHT_EXPECTATIONS,
} from "../test/fixtures/expectations.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const VARIANTS = [
  {
    name: "astro6",
    template: "site",
    deps: { astro: "6.4.8", "@astrojs/mdx": "5.0.6", "@astrojs/node": "10.1.4" },
  },
  {
    name: "astro7",
    template: "site",
    deps: { astro: "7.3.5", "@astrojs/mdx": "8.0.3", "@astrojs/node": "11.1.7" },
  },
  {
    name: "starlight-astro6",
    template: "starlight",
    deps: { astro: "6.4.8", "@astrojs/starlight": "0.38.5" },
  },
  {
    name: "starlight-astro7",
    template: "starlight",
    deps: { astro: "7.3.5", "@astrojs/starlight": "0.42.6" },
  },
];

const filter = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const selected = VARIANTS.filter(
  (v) => filter.length === 0 || filter.some((f) => v.name.includes(f))
);

const work = mkdtempSync(join(tmpdir(), "astro-trademarks-fixtures-"));
const run = (cmd, args, cwd, extra = {}) =>
  execFileSync(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", ...extra });

// ---- pack once -------------------------------------------------------------
run("pnpm", ["run", "build"], ROOT);
const packed = run("pnpm", ["pack", "--pack-destination", work, "--json"], ROOT);
const tarball =
  JSON.parse(packed).filename ??
  join(work, readdirSync(work).find((f) => f.endsWith(".tgz")) ?? "missing.tgz");

function setUp(variant) {
  const dir = join(work, variant.name);
  cpSync(join(ROOT, "test/fixtures", variant.template), dir, { recursive: true });
  // One registry for every fixture, and for the oracle that checks them.
  for (const f of ["marks.mjs", "marks-data.mjs"])
    cpSync(join(ROOT, "test/fixtures", f), join(dir, f));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify(
      {
        name: `fixture-${variant.name}`,
        private: true,
        type: "module",
        dependencies: { ...variant.deps, "@wave-rf/astro-trademarks": `file:${tarball}` },
      },
      null,
      2
    )
  );
  writeFileSync(
    join(dir, "pnpm-workspace.yaml"),
    "allowBuilds:\n  esbuild: true\n  sharp: true\nminimumReleaseAge: 0\n"
  );
  run("pnpm", ["install", "--no-frozen-lockfile"], dir, { timeout: 300_000 });
  return dir;
}

function readPage(dir, path) {
  const candidates = [join(dir, "dist", path), join(dir, "dist/client", path)];
  const file = candidates.find((f) => existsSync(f));
  if (!file) throw new Error(`no built file for ${path} in ${candidates.join(", ")}`);
  return readFileSync(file, "utf8");
}

async function waitFor(url, ms = 60_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`timed out waiting for ${url}`);
}

// A dev server can answer before the content layer has synced (Starlight's
// first request may 404); retry until the page itself is served.
async function getPage(url, ms = 30_000) {
  const until = Date.now() + ms;
  for (;;) {
    const r = await fetch(url);
    const body = await r.text();
    if (r.status === 200 || Date.now() > until) {
      if (r.status !== 200) throw new Error(`${url}: HTTP ${r.status}`);
      return body;
    }
    await new Promise((res) => setTimeout(res, 500));
  }
}

async function withServer(cmd, args, cwd, port, env, fn) {
  // Own process group, so the whole tree (pnpm -> node) dies with it.
  const child = spawn(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let log = "";
  child.stdout.on("data", (d) => {
    log += d;
  });
  child.stderr.on("data", (d) => {
    log += d;
  });
  try {
    await waitFor(`http://localhost:${port}/`);
    await fn(`http://localhost:${port}`);
  } catch (err) {
    err.message += `\n--- server log ---\n${log.slice(-4000)}`;
    throw err;
  } finally {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
  }
}

// Random base port: a dev server left over from an earlier run must never be the
// one these tests talk to (Vite would silently pick the next free port).
let port = 20000 + Math.floor(Math.random() * 20000);
for (const variant of selected) {
  test(variant.name, { timeout: 900_000 }, async (t) => {
    const dir = setUp(variant);
    const versions = run("pnpm", ["list", "--depth", "0", "--json"], dir);
    const deps = JSON.parse(versions)[0]?.dependencies ?? {};
    t.diagnostic(
      Object.entries(deps)
        .map(([k, v]) => `${k}@${v.version}`)
        .join(" ")
    );

    const buildLog = run("pnpm", ["exec", "astro", "build"], dir, { timeout: 600_000 });
    if (process.env.VERBOSE) console.log(buildLog);

    if (variant.template === "site") {
      await t.test("astro build: prerendered pages", () => {
        for (const [path, expected] of Object.entries(SITE_EXPECTATIONS.static)) {
          checkSitePage(readPage(dir, path), expected, `build ${path}`);
        }
      });
      await t.test("astro build: symbol styles injected", () => {
        // Inlined into the page, or emitted as a stylesheet, depending on size.
        const astroDir = [join(dir, "dist/client/_astro"), join(dir, "dist/_astro")].find(
          existsSync
        );
        const sheets = astroDir
          ? readdirSync(astroDir)
              .filter((f) => f.endsWith(".css"))
              .map((f) => readFileSync(join(astroDir, f), "utf8"))
          : [];
        if (
          ![readPage(dir, "index.html"), ...sheets].some((css) =>
            css.includes(":where(.tm-symbol)")
          )
        ) {
          throw new Error("styles.css (.tm-symbol) was not injected into the page");
        }
      });
      await t.test("astro build: text endpoints untouched", () => {
        assertEqual(readPage(dir, "llms.txt"), "Docs for ClickHouse and Grafana.\n", "llms.txt");
        assertEqual(
          readPage(dir, "twin.md"),
          "# ClickHouse\n\nGrafana reads `Docker` logs.\n",
          "twin.md"
        );
      });

      const serverPort = port++;
      await t.test("on-demand page through the adapter (streamed render)", async () => {
        await withServer(
          "node",
          ["dist/server/entry.mjs"],
          dir,
          serverPort,
          { PORT: String(serverPort), HOST: "localhost" },
          async (base) => {
            const r = await fetch(`${base}/ssr`);
            checkSitePage(await r.text(), SITE_EXPECTATIONS.ssr, "server /ssr");
            assertEqual(r.headers.get("content-length"), null, "no stale content-length");
          }
        );
      });
    } else {
      await t.test("astro build: starlight pages", () => {
        for (const [path, expected] of Object.entries(STARLIGHT_EXPECTATIONS)) {
          checkStarlight(readPage(dir, path), expected, `build ${path}`);
        }
      });
    }

    await t.test("astro dev", async (tt) => {
      const check = async (base) => {
        if (variant.template === "site") {
          const pages = { ...SITE_EXPECTATIONS.static, "ssr/index.html": SITE_EXPECTATIONS.ssr };
          for (const [path, expected] of Object.entries(pages)) {
            const url = `${base}/${path.replace(/index\.html$/, "")}`;
            checkSitePage(await getPage(url), expected, `dev ${url}`);
          }
          assertEqual(
            await (await fetch(`${base}/llms.txt`)).text(),
            "Docs for ClickHouse and Grafana.\n",
            "dev llms.txt"
          );
        } else {
          for (const [path, expected] of Object.entries(STARLIGHT_EXPECTATIONS)) {
            const url = `${base}/${path.replace(/index\.html$/, "")}`;
            checkStarlight(await getPage(url), expected, `dev ${url}`);
          }
        }
      };
      // Starlight on Astro 7 occasionally starts a dev server whose docs
      // collection is empty (every page 404s — the route itself is missing, so
      // no response reaches the middleware). Not reproduced outside this
      // harness; one restart is allowed and reported, a second failure fails.
      for (let attempt = 1; ; attempt++) {
        const devPort = port++;
        // --ignore-lock: Astro 7 auto-backgrounds `astro dev` when it detects
        // an AI agent, which would outlive this test; this keeps it in the
        // foreground. (Astro 7 refuses --force together with it, so the
        // content-layer cache is cleared by hand instead.)
        const args = ["exec", "astro", "dev", "--port", String(devPort), "--ignore-lock"];
        for (const cache of [".astro", "node_modules/.astro"]) {
          rmSync(join(dir, cache), { recursive: true, force: true });
        }
        try {
          await withServer("pnpm", args, dir, devPort, {}, check);
          return;
        } catch (err) {
          if (attempt >= 2 || !/HTTP 404/.test(err.message)) throw err;
          tt.diagnostic(`dev server served 404s; restarting once (${err.message.split("\n")[0]})`);
        }
      }
    });
  });
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

test.after(() => {
  if (process.env.KEEP) console.log(`fixtures kept in ${work}`);
  else rmSync(work, { recursive: true, force: true });
});

mkdirSync(work, { recursive: true });
