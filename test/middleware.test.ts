import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { APIContext, MiddlewareHandler } from "astro";
import { defineTrademarks } from "../src/core.ts";
import { createTrademarksMiddleware, transformResponse } from "../src/handler.ts";
import { resolveOptions, type TrademarksOptions } from "../src/options.ts";

const MARKS = defineTrademarks([
  { name: "ClickHouse", symbol: "®", owner: "ClickHouse, Inc." },
  { name: "Grafana", symbol: "®", owner: "Grafana Labs" },
  { name: "Kubernetes", symbol: "®", owner: "The Linux Foundation" },
  { name: "Docker", symbol: "®", owner: "Docker, Inc." },
]);

/** A page as Astro renders it: notices placeholder from the component, in the footer. */
const PAGE = (main: string) =>
  `<!DOCTYPE html><html><head><title>ClickHouse</title></head><body><main>${main}</main>` +
  '<footer><div class="tm-notices" data-tm-notices><p class="tm-notices__body"><span class="tm-notices__list" data-tm-slot></span>' +
  '<span class="tm-notices__catch-all">All other trademarks are the property of their respective owners.</span></p></div></footer></body></html>';

/** A streamed response, split into chunks that cut through a mark's name. */
function streamed(html: string, type = "text/html; charset=utf-8", chunk = 7): Response {
  const bytes = new TextEncoder().encode(html);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunk) controller.enqueue(bytes.slice(i, i + chunk));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": type, "content-length": String(bytes.length), "x-kept": "yes" },
  });
}

async function through(
  handler: MiddlewareHandler,
  response: Response,
  context: Partial<APIContext> = { isPrerendered: true }
) {
  const out = await handler(context as APIContext, async () => response);
  return out as Response;
}

const notices = (html: string) =>
  [...html.matchAll(/<span class="tm-notice">([^<]*)<\/span>/g)].map((m) => m[1]);

describe("middleware: text/html", () => {
  const mw = createTrademarksMiddleware({ marks: MARKS });

  // The derived-input test: the notices come out of the page the handler is
  // given. Nothing here tells the code which marks were "found" — if the scan
  // that decides notices ever diverges from the scan that places symbols, a
  // notice appears for a mark with no symbol and this fails.
  test("notices are derived from the rendered page, by the same scan that marks it", async () => {
    const html = PAGE(
      "<h1>Kubernetes and ClickHouse</h1>" +
        "<p>We run ClickHouse in production.</p>" +
        "<pre><code>docker run grafana/grafana Grafana Docker</code></pre>"
    );
    const out = await (await through(mw, streamed(html))).text();
    // ClickHouse: in a heading (skipped) and in prose (marked) -> one symbol, one notice.
    assert.equal((out.match(/class="tm-symbol"/g) ?? []).length, 1);
    assert.ok(
      out.includes('<p>We run ClickHouse<span class="tm-symbol">®</span> in production.</p>')
    );
    // Kubernetes only in a heading, Grafana/Docker only in code: no symbol, so no notice.
    assert.deepEqual(notices(out), ["ClickHouse® is a registered trademark of ClickHouse, Inc."]);
    // <title> is outside the content root.
    assert.ok(out.includes("<title>ClickHouse</title>"));
  });

  test("a page with no visible mark loses its notices block", async () => {
    const out = await (
      await through(mw, streamed(PAGE("<h2>Docker</h2><code>Grafana</code>")))
    ).text();
    assert.ok(!out.includes("data-tm-notices"));
    assert.ok(!out.includes("tm-symbol"));
  });

  test("buffers a streamed body, keeps status and headers, drops the stale content-length", async () => {
    const res = await through(mw, streamed(PAGE("<p>Docker</p>"), "text/html; charset=utf-8", 3));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-kept"), "yes");
    assert.equal(res.headers.get("content-length"), null);
    assert.ok((await res.text()).includes('Docker<span class="tm-symbol">®</span>'));
  });

  test("non-200 HTML (a 404 page) is processed too", async () => {
    const res = await through(
      mw,
      new Response(PAGE("<p>No Docker here.</p>"), {
        status: 404,
        headers: { "content-type": "text/html" },
      })
    );
    assert.equal(res.status, 404);
    assert.ok((await res.text()).includes("tm-symbol"));
  });

  test("onDemand: false leaves on-demand pages alone", async () => {
    const prerenderedOnly = createTrademarksMiddleware({ marks: MARKS, onDemand: false });
    const original = streamed(PAGE("<p>Docker</p>"));
    assert.equal(await through(prerenderedOnly, original, { isPrerendered: false }), original);
    const res = await through(prerenderedOnly, streamed(PAGE("<p>Docker</p>")), {
      isPrerendered: true,
    });
    assert.ok((await res.text()).includes("tm-symbol"));
  });
});

describe("middleware: other content types", () => {
  const md = "# ClickHouse\n\nGrafana reads `Docker` logs.\n";

  test("text/markdown and text/plain are untouched by default", async () => {
    const mw = createTrademarksMiddleware({ marks: MARKS });
    const mdRes = streamed(md, "text/markdown; charset=utf-8");
    assert.equal(await through(mw, mdRes), mdRes);
    const txt = new Response("ClickHouse docs", { headers: { "content-type": "text/plain" } });
    assert.equal(await through(mw, txt), txt);
  });

  test("other types and bodiless responses pass through as the same object", async () => {
    const mw = createTrademarksMiddleware({ marks: MARKS });
    const json = new Response('{"x":"ClickHouse"}', {
      headers: { "content-type": "application/json" },
    });
    assert.equal(await through(mw, json), json);
    const redirect = new Response(null, {
      status: 302,
      headers: { location: "/", "content-type": "text/html" },
    });
    assert.equal(await through(mw, redirect), redirect);
  });

  test("machineReadable.markdown appends attribution, ignoring code", async () => {
    const options: TrademarksOptions = { marks: MARKS, machineReadable: { markdown: true } };
    const res = await transformResponse(streamed(md, "text/markdown"), options);
    assert.equal(
      await res.text(),
      `${md}\nClickHouse® is a registered trademark of ClickHouse, Inc. Grafana® is a registered trademark of Grafana Labs. All other trademarks are the property of their respective owners.\n`
    );
  });

  test("machineReadable.plain appends; catchAll: false drops the catch-all; nothing named, nothing added", async () => {
    const o = resolveOptions({ marks: MARKS, machineReadable: { plain: true, catchAll: false } });
    const res = await transformResponse(
      new Response("Docker docs", { headers: { "content-type": "text/plain" } }),
      o
    );
    assert.equal(
      await res.text(),
      "Docker docs\n\nDocker® is a registered trademark of Docker, Inc.\n"
    );
    const none = await transformResponse(
      new Response("plain", { headers: { "content-type": "text/plain" } }),
      o
    );
    assert.equal(await none.text(), "plain");
  });
});

describe("options", () => {
  test("defaults", () => {
    const o = resolveOptions({ marks: MARKS });
    assert.deepEqual(o.contentRoots, ["main"]);
    assert.equal(o.symbolClass, "tm-symbol");
    assert.equal(o.onDemand, true);
    assert.deepEqual(o.machineReadable, {
      markdown: false,
      plain: false,
      catchAll: "All other trademarks are the property of their respective owners.",
    });
    assert.ok(o.skipTags.includes("h1") && o.skipTags.includes("code"));
    assert.ok(!o.skipClasses.includes("sl-link-button"));
  });

  test("skipTags/skipClasses add to the defaults", () => {
    const o = resolveOptions({ marks: MARKS, skipTags: ["ASIDE"], skipClasses: ["ui"] });
    assert.ok(o.skipTags.includes("aside") && o.skipTags.includes("pre"));
    assert.ok(o.skipClasses.includes("ui") && o.skipClasses.includes("katex"));
  });

  test("resolved options survive JSON (they travel to the middleware as a virtual module)", () => {
    const o = resolveOptions({ marks: MARKS }, true);
    assert.deepEqual(JSON.parse(JSON.stringify(o)), o);
  });

  test("validation runs at config time", () => {
    assert.throws(() => resolveOptions({} as TrademarksOptions), /`marks` is required/);
    assert.throws(
      () => resolveOptions({ marks: MARKS, contentRoots: ["main p"] }),
      /compound selectors/
    );
  });
});
