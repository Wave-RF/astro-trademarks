import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { defineTrademarks, type Trademark } from "../src/core.ts";
import { parseSelectors, type TransformHtmlOptions, transformHtml } from "../src/html.ts";
import { resolveOptions } from "../src/options.ts";

const MARKS = defineTrademarks([
  { name: "ClickHouse", symbol: "®", owner: "ClickHouse, Inc." },
  { name: "Grafana", symbol: "®", owner: "Grafana Labs" },
  { name: "Grafana Loki", aliases: ["Grafana Loki", "Loki"], symbol: "™", owner: "Grafana Labs" },
  { name: "Docker", symbol: "®", owner: "Docker, Inc." },
  { name: "AT&T", symbol: "®", owner: "AT&T Intellectual Property" },
  { name: "Acme", symbol: "™" },
  { name: "Bluetooth", symbol: "®", owner: "Bluetooth SIG, Inc.", triggers: ["BLE"] },
] satisfies Trademark[]);

const SYM = (s: string) => `<span class="tm-symbol">${s}</span>`;
const PLACEHOLDER =
  '<div class="tm-notices" data-tm-notices><p><span data-tm-slot></span><span>All other.</span></p></div>';

function page(main: string, extra = "") {
  return `<!doctype html><html><head><title>t</title></head><body><main>${main}</main><footer>${PLACEHOLDER}</footer>${extra}</body></html>`;
}

function run(html: string, options: Partial<TransformHtmlOptions> = {}) {
  return transformHtml(html, { marks: MARKS, ...options });
}

function mainOf(html: string) {
  return html.slice(html.indexOf("<main>") + 6, html.indexOf("</main>"));
}

const found = (html: string, options?: Partial<TransformHtmlOptions>) =>
  run(html, options).found.map((m) => m.name);

describe("skip rules (golden)", () => {
  const skipped: [string, string][] = [
    ["h1", "<h1>ClickHouse</h1>"],
    ["h2", "<h2>ClickHouse</h2>"],
    ["h3", "<h3>ClickHouse</h3>"],
    ["h4", "<h4>ClickHouse</h4>"],
    ["h5", "<h5>ClickHouse</h5>"],
    ["h6", "<h6>ClickHouse</h6>"],
    ["code", "<p><code>ClickHouse</code></p>"],
    ["pre", "<pre>ClickHouse</pre>"],
    ["kbd", "<kbd>ClickHouse</kbd>"],
    ["samp", "<samp>ClickHouse</samp>"],
    ["var", "<var>ClickHouse</var>"],
    ["svg", "<svg><text>ClickHouse</text></svg>"],
    ["math", "<math><mi>ClickHouse</mi></math>"],
    ["button", "<button>ClickHouse</button>"],
    ["select", "<select><option>ClickHouse</option></select>"],
    [".katex", '<span class="katex">ClickHouse</span>'],
    [".expressive-code", '<div class="expressive-code"><p>ClickHouse</p></div>'],
    ["nested in a skipped element", "<h2><a href='#'><em>ClickHouse</em></a></h2>"],
    ["[aria-hidden]", '<p aria-hidden="true">ClickHouse</p>'],
    ["[hidden]", "<p hidden>ClickHouse</p>"],
    ["[data-tm-skip]", "<p data-tm-skip>ClickHouse</p>"],
    ["nav", '<nav><a href="/x">ClickHouse</a></nav>'],
    ["menu", "<menu><li>ClickHouse</li></menu>"],
    ['[role="menu"]', '<ul role="menu"><li><a href="/x">ClickHouse</a></li></ul>'],
    ['[role="menubar"]', '<div role="menubar"><span>ClickHouse</span></div>'],
    ['[role="menuitem"]', '<ul><li role="menuitem">ClickHouse</li></ul>'],
    ['[role="navigation"]', '<div role="navigation">ClickHouse</div>'],
  ];
  for (const [rule, markup] of skipped) {
    test(`${rule}: no symbol, no notice, and the next prose mention is the first`, () => {
      const r = run(page(`${markup}<p>Then ClickHouse.</p>`));
      assert.equal(mainOf(r.html), `${markup}<p>Then ClickHouse${SYM("®")}.</p>`);
      assert.deepEqual(
        r.found.map((m) => m.name),
        ["ClickHouse"]
      );
    });
    test(`${rule}: alone on the page, no notice and the block is removed`, () => {
      const r = run(page(markup));
      assert.deepEqual(r.found, []);
      assert.equal(mainOf(r.html), markup);
      assert.ok(!r.html.includes("data-tm-notices"));
    });
  }

  for (const tag of ["script", "style", "template", "textarea", "noscript"]) {
    test(`<${tag}> is never read, not even for a typed symbol`, () => {
      const markup = `<${tag}>ClickHouse® ClickHouse</${tag}>`;
      const r = run(page(markup));
      assert.deepEqual(r.found, []);
      assert.equal(mainOf(r.html), markup);
    });
  }

  test("custom skipTags and skipClasses", () => {
    const html = page('<aside>ClickHouse</aside><p class="ui">Grafana</p><p>Docker</p>');
    assert.deepEqual(found(html, { skipTags: ["aside"], skipClasses: ["ui"] }), ["Docker"]);
  });

  test("the starlight preset adds its chrome classes", () => {
    const html = page(
      '<a class="sl-link-button">Grafana</a><div class="sl-link-card">Grafana</div>' +
        '<p class="starlight-aside__title">Grafana</p>' +
        '<div class="sl-heading-wrapper"><h2>Grafana</h2><a class="sl-anchor-link"><span>Section titled “Grafana”</span></a></div>' +
        '<div class="pagination-links"><a>Grafana</a></div><p>Docker</p>'
    );
    const plain = resolveOptions({ marks: MARKS });
    const starlight = resolveOptions({ marks: MARKS }, true);
    assert.deepEqual(found(html, starlight), ["Docker"]);
    assert.deepEqual(found(html, plain), ["Grafana", "Docker"]);
    assert.deepEqual(found(html, resolveOptions({ marks: MARKS, presets: [] }, true)), [
      "Grafana",
      "Docker",
    ]);
  });

  test("astro-island markup is not marked, but its slotted server HTML is", () => {
    const html = page(
      "<astro-island><p>ClickHouse in the island</p><astro-slot><p>Grafana in the slot</p></astro-slot></astro-island><p>ClickHouse after</p>"
    );
    const r = run(html);
    assert.equal(
      mainOf(r.html),
      `<astro-island><p>ClickHouse in the island</p><astro-slot><p>Grafana${SYM("®")} in the slot</p></astro-slot></astro-island><p>ClickHouse${SYM("®")} after</p>`
    );
  });

  test("a heading inside an island keeps its slot skipped", () => {
    const html = page("<astro-island><h2><astro-slot>Grafana</astro-slot></h2></astro-island>");
    assert.deepEqual(found(html), []);
  });
});

describe("first mention", () => {
  test("across sibling elements", () => {
    const r = run(
      page("<p>ClickHouse one.</p><p>ClickHouse two.</p><ul><li>ClickHouse three</li></ul>")
    );
    assert.equal(
      mainOf(r.html),
      `<p>ClickHouse${SYM("®")} one.</p><p>ClickHouse two.</p><ul><li>ClickHouse three</li></ul>`
    );
  });

  test("inside inline markup", () => {
    const r = run(page('<p>See <a href="/x"><strong>Docker</strong></a> and Docker.</p>'));
    assert.equal(
      mainOf(r.html),
      `<p>See <a href="/x"><strong>Docker${SYM("®")}</strong></a> and Docker.</p>`
    );
  });

  test("longest alias wins, and both marks of one owner share a notice", () => {
    const r = run(page("<p>Grafana Loki feeds Grafana. Loki again.</p>"));
    assert.equal(
      mainOf(r.html),
      `<p>Grafana Loki${SYM("™")} feeds Grafana${SYM("®")}. Loki again.</p>`
    );
    assert.deepEqual(
      r.notices.map((n) => n.text),
      ["Grafana® and Grafana Loki™ are trademarks of Grafana Labs."]
    );
  });

  test("a word split across elements is not a mention", () => {
    assert.deepEqual(found(page("<p>Click<b>House</b></p>")), []);
  });

  test("triggers count toward notices but are never marked", () => {
    const r = run(page("<p>Pairs over BLE.</p><p>Bluetooth later.</p>"));
    assert.equal(mainOf(r.html), `<p>Pairs over BLE.</p><p>Bluetooth${SYM("®")} later.</p>`);
    assert.deepEqual(
      r.found.map((m) => m.name),
      ["Bluetooth"]
    );
  });

  test("a trigger inside a skipped element does not count", () => {
    assert.deepEqual(found(page("<h2>BLE</h2><code>BLE</code>")), []);
  });
});

describe("symbols already on the page", () => {
  test("typed in prose: counted, not doubled", () => {
    const r = run(page("<p>ClickHouse® and ClickHouse.</p>"));
    assert.equal(mainOf(r.html), "<p>ClickHouse® and ClickHouse.</p>");
    assert.deepEqual(
      r.notices.map((n) => n.text),
      ["ClickHouse® is a registered trademark of ClickHouse, Inc."]
    );
  });

  test("as an entity and in a following element", () => {
    const r = run(page("<p>ClickHouse&reg; and Grafana<sup>®</sup>, Grafana.</p>"));
    assert.equal(mainOf(r.html), "<p>ClickHouse&reg; and Grafana<sup>®</sup>, Grafana.</p>");
    assert.equal(r.found.length, 2);
  });

  test("typed in a heading: the heading is the first mention, and it is noticed", () => {
    const r = run(page("<h2>Built on ClickHouse®</h2><p>ClickHouse is fast.</p>"));
    assert.equal(mainOf(r.html), "<h2>Built on ClickHouse®</h2><p>ClickHouse is fast.</p>");
    assert.deepEqual(
      r.found.map((m) => m.name),
      ["ClickHouse"]
    );
  });
});

describe("content roots", () => {
  test("text outside the root is neither marked nor noticed", () => {
    const html = page("<p>Nothing.</p>", "<nav>ClickHouse</nav>");
    const r = run(`<header>Docker</header>${html}`);
    assert.deepEqual(r.found, []);
    assert.ok(!r.html.includes("tm-symbol"));
  });

  test("several roots, in document order, with one first-mention state", () => {
    const html =
      '<body><div class="hero">ClickHouse</div><article>ClickHouse and Docker</article><aside class="hero">Docker</aside></body>';
    const r = run(html, { contentRoots: [".hero", "article"] });
    assert.equal(
      r.html,
      `<body><div class="hero">ClickHouse${SYM("®")}</div><article>ClickHouse and Docker${SYM("®")}</article><aside class="hero">Docker</aside></body>`
    );
  });

  test("a root nested in a root is scanned once", () => {
    const r = run("<main><main>Docker</main></main>", { contentRoots: ["main"] });
    assert.equal((r.html.match(/tm-symbol/g) ?? []).length, 1);
  });

  test("compound selectors", () => {
    const html = '<div id="a" class="x y" data-k="v">Docker</div><div class="x">ClickHouse</div>';
    assert.deepEqual(found(html, { contentRoots: ['div#a.x.y[data-k="v"]'] }), ["Docker"]);
    assert.deepEqual(found(html, { contentRoots: ["[data-k]"] }), ["Docker"]);
    assert.deepEqual(found(html, { contentRoots: ["*.x"] }), ["Docker", "ClickHouse"]);
  });

  test("combinators are rejected, not silently misread", () => {
    assert.throws(() => parseSelectors(["main article"]), /compound selectors/);
    assert.throws(() => parseSelectors(["main > p"]), /compound selectors/);
    assert.throws(() => parseSelectors(["p:first-child"]), /compound selectors/);
  });
});

describe("source fidelity", () => {
  test("a page that names no mark and has no placeholder is returned as-is", () => {
    const html =
      "<!DOCTYPE html><html><body><main><p class='x'>Plain &amp; simple<br/></p></main></body></html>";
    const r = run(html);
    assert.equal(r.html, html);
    assert.equal(r.changed, false);
  });

  test("only the insertion changes; attributes, quoting and entities stay byte-identical", () => {
    const html = "<main><p class='x' data-a=1>Use ClickHouse&#39;s &nbsp;engine<br/></p></main>";
    assert.equal(
      run(html).html,
      `<main><p class='x' data-a=1>Use ClickHouse${SYM("®")}&#39;s &nbsp;engine<br/></p></main>`
    );
  });

  test("an alias containing an entity", () => {
    const r = run("<main><p>Call AT&amp;T today.</p></main>");
    assert.equal(r.html, `<main><p>Call AT&amp;T${SYM("®")} today.</p></main>`);
  });

  test("CRLF line endings", () => {
    const r = run("<main><p>One\r\nDocker\r\ntwo</p></main>");
    assert.equal(r.html, `<main><p>One\r\nDocker${SYM("®")}\r\ntwo</p></main>`);
  });

  test("non-ASCII text before the mark", () => {
    const r = run("<main><p>Ünïcödé 🚀 Docker</p></main>");
    assert.equal(r.html, `<main><p>Ünïcödé 🚀 Docker${SYM("®")}</p></main>`);
  });

  test("custom symbol class", () => {
    const r = run("<main>Docker</main>", { symbolClass: "wh-tm" });
    assert.equal(r.html, '<main>Docker<span class="wh-tm">®</span></main>');
  });

  test("idempotent", () => {
    const once = run(page("<p>ClickHouse, Grafana and BLE.</p>")).html;
    assert.equal(run(once).html, once);
  });
});

describe("notice links", () => {
  const LINKED = defineTrademarks([
    {
      name: "ClickHouse",
      symbol: "®",
      owner: "ClickHouse, Inc.",
      link: "https://clickhouse.example/?a=1&b=2",
    },
    { name: "Grafana", symbol: "®", owner: "Grafana Labs", link: "https://grafana.example" },
    {
      name: "Grafana Loki",
      aliases: ["Grafana Loki", "Loki"],
      symbol: "™",
      owner: "Grafana Labs",
      link: "https://grafana.example",
    },
    { name: "Acme", symbol: "™", link: "https://acme.example" },
  ]);
  const notice = (html: string) =>
    /<span data-tm-slot>([\s\S]*?)<\/span><span>All other/.exec(html)?.[1];

  test("golden: the URL is linked after the sentence, escaped, with rel", () => {
    const r = transformHtml(page("<p>ClickHouse runs.</p>"), { marks: LINKED });
    assert.equal(
      notice(r.html),
      '<span class="tm-notice">ClickHouse® is a registered trademark of ClickHouse, Inc. <a class="tm-notice__link" href="https://clickhouse.example/?a=1&amp;b=2" rel="noopener noreferrer">https://clickhouse.example/?a=1&amp;b=2</a></span> '
    );
  });

  test('linkTarget: "_blank"', () => {
    const r = transformHtml(page("<p>ClickHouse</p>"), { marks: LINKED, linkTarget: "_blank" });
    assert.ok(r.html.includes('rel="noopener noreferrer" target="_blank">'));
  });

  test("one owner group, one identical URL: linked once", () => {
    const r = transformHtml(page("<p>Grafana Loki and Grafana</p>"), { marks: LINKED });
    assert.equal(
      notice(r.html),
      '<span class="tm-notice">Grafana® and Grafana Loki™ are trademarks of Grafana Labs. <a class="tm-notice__link" href="https://grafana.example" rel="noopener noreferrer">https://grafana.example</a></span> '
    );
  });

  test("an ownerless mark's link is not rendered", () => {
    const r = transformHtml(page("<p>Acme</p>"), { marks: LINKED });
    assert.ok(!r.html.includes("acme.example"));
  });

  test("a javascript: link never reaches the page", () => {
    const evil = [
      { name: "Evil", symbol: "™", owner: "E", link: "javascript:alert(1)" },
    ] as Trademark[];
    assert.throws(
      () => transformHtml(page("<p>Evil</p>"), { marks: evil }),
      /link must be an absolute http/
    );
  });
});

describe("notices placeholder", () => {
  test("filled with notices for exactly the marks found", () => {
    const r = run(page("<h2>Grafana</h2><p>ClickHouse runs.</p><pre>Docker</pre>"));
    assert.ok(
      r.html.includes(
        '<span data-tm-slot><span class="tm-notice">ClickHouse® is a registered trademark of ClickHouse, Inc.</span> </span><span>All other.</span>'
      )
    );
    assert.ok(!r.html.includes("Grafana Labs"));
    assert.ok(!r.html.includes("Docker, Inc."));
  });

  test("removed entirely when no mark is found", () => {
    const r = run(page("<p>Nothing.</p>"));
    assert.ok(!r.html.includes("tm-notices"));
    assert.ok(r.html.includes("<footer></footer>"));
  });

  test("gated on marks found, not on notices: an ownerless mark keeps the catch-all", () => {
    const r = run(page("<p>The Acme widget.</p>"));
    assert.deepEqual(r.notices, []);
    assert.ok(r.html.includes("<span data-tm-slot></span><span>All other.</span>"));
  });

  test("missing placeholder: content is still marked", () => {
    const r = run("<main>Docker</main>");
    assert.equal(r.html, `<main>Docker${SYM("®")}</main>`);
  });

  test("placeholder without a slot: notices go first inside it", () => {
    const r = run("<main>Docker</main><div data-tm-notices><p>Others.</p></div>");
    assert.ok(
      r.html.includes(
        '<div data-tm-notices><span class="tm-notice">Docker® is a registered trademark of Docker, Inc.</span> <p>Others.</p></div>'
      )
    );
  });

  test("a placeholder inside the content root is not scanned", () => {
    const html = `<main><p>Grafana</p>${PLACEHOLDER}</main>`;
    const r = run(html);
    assert.deepEqual(
      r.found.map((m) => m.name),
      ["Grafana"]
    );
    assert.equal((r.html.match(/tm-symbol/g) ?? []).length, 1);
  });

  test("every placeholder on the page is filled", () => {
    const r = run(`<main>Docker</main>${PLACEHOLDER}${PLACEHOLDER}`);
    assert.equal((r.html.match(/class="tm-notice"/g) ?? []).length, 2);
  });

  test("notice text is HTML-escaped", () => {
    const marks = defineTrademarks([{ name: "X<Y", symbol: "™", owner: "A & <B>" }]);
    const r = transformHtml(`<main>X&lt;Y</main>${PLACEHOLDER}`, { marks });
    assert.ok(r.html.includes("X&lt;Y™ is a trademark of A &amp; &lt;B&gt;."));
  });
});
