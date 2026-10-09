import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  DEFAULT_CATCH_ALL,
  defineTrademarks,
  findTrademarks,
  markFirstMentions,
  noticesForText,
  stripMarkdownCode,
  type Trademark,
  trademarkNoticeEntries,
  trademarkNotices,
} from "../src/core.ts";

const CH: Trademark = { name: "ClickHouse", symbol: "®", owner: "ClickHouse, Inc." };
const GRAFANA: Trademark = { name: "Grafana", symbol: "®", owner: "Grafana Labs" };
const LOKI: Trademark = {
  name: "Grafana Loki",
  aliases: ["Grafana Loki", "Loki"],
  symbol: "™",
  owner: "Grafana Labs",
};
const NODE: Trademark = { name: "Node.js", symbol: "®", owner: "the OpenJS Foundation" };
const NATS: Trademark = { name: "NATS", symbol: "™", owner: "The Linux Foundation" };
const K8S: Trademark = { name: "Kubernetes", symbol: "®", owner: "The Linux Foundation" };
const CLAUDE: Trademark = { name: "Claude", symbol: "™", owner: "Anthropic PBC" };
const CLAUDE_CODE: Trademark = { name: "Claude Code", symbol: "™", owner: "Anthropic PBC" };
const BT: Trademark = {
  name: "Bluetooth",
  symbol: "®",
  owner: "Bluetooth SIG, Inc.",
  triggers: ["BLE"],
  licensed: "Example Corp.",
};
const THREAD: Trademark = { name: "Thread", symbol: "®", owner: "Thread Group, Inc." };
const DOCKER: Trademark = { name: "Docker", symbol: "®", owner: "Docker, Inc." };

const MARKS = defineTrademarks([
  CH,
  GRAFANA,
  LOKI,
  NODE,
  NATS,
  K8S,
  CLAUDE,
  CLAUDE_CODE,
  BT,
  THREAD,
  DOCKER,
]);

const names = (marks: Trademark[]) => marks.map((m) => m.name);
const render = (text: string, marked = new Set<Trademark>()) =>
  markFirstMentions(text, MARKS, marked)
    .map((r) => r.text + (r.mark ? r.mark.symbol : ""))
    .join("");

describe("defineTrademarks", () => {
  test("returns the registry unchanged", () => {
    const marks = [CH];
    assert.equal(defineTrademarks(marks), marks);
  });

  test("rejects a symbol other than ® or ™", () => {
    assert.throws(
      () => defineTrademarks([{ name: "X", symbol: "(R)" as "®" }]),
      /symbol must be "®" or "™"/
    );
  });

  test("rejects an empty alias or trigger", () => {
    assert.throws(() => defineTrademarks([{ name: "X", symbol: "™", aliases: [""] }]), /non-empty/);
    assert.throws(
      () => defineTrademarks([{ name: "X", symbol: "™", triggers: [" "] }]),
      /non-empty/
    );
  });

  test("rejects one spelling claimed by two marks", () => {
    assert.throws(
      () => defineTrademarks([CH, { name: "Other", aliases: ["ClickHouse"], symbol: "™" }]),
      /claimed by both "ClickHouse" and "Other"/
    );
  });

  test("a case-insensitive mark collides with every casing of another", () => {
    assert.throws(
      () => defineTrademarks([CH, { name: "clickhouse", symbol: "™", caseSensitive: false }]),
      /claimed by both/
    );
  });

  test("case-sensitive spellings that differ only in case do not collide", () => {
    assert.doesNotThrow(() =>
      defineTrademarks([
        { name: "NGINX", aliases: ["NGINX", "Nginx"], symbol: "®" },
        { name: "nginx-thing", aliases: ["nginx"], symbol: "™" },
      ])
    );
  });
});

describe("boundaries", () => {
  const cases: [string, string[]][] = [
    ["ClickHouse-backed storage", ["ClickHouse"]],
    ["ClickHouse's engine", ["ClickHouse"]],
    ["(ClickHouse)", ["ClickHouse"]],
    ["ClickHouse.", ["ClickHouse"]],
    ["clickhouse.com", []],
    ["ClickHouse.com", []],
    ["ClickHouseDB", []],
    ["MyClickHouse", []],
    ["NATSy", []],
    ["NATS2", []],
    ["my_NATS", []],
    ["Node.js, then", ["Node.js"]],
    ["Node.jsx", []],
    ["github.com/ClickHouse/ClickHouse", []],
    ["@Docker", []],
    ["#Docker", []],
    ["https://example.com/Docker", []],
    ["www.Docker.io", []],
    ["éDocker", []],
    ["Docker images", ["Docker"]],
  ];
  for (const [text, expected] of cases) {
    test(JSON.stringify(text), () => {
      assert.deepEqual(names(findTrademarks(text, MARKS)), expected);
    });
  }
});

describe("longest alias wins", () => {
  test('"Grafana Loki" beats "Grafana" at the same position', () => {
    assert.equal(render("Grafana Loki and Grafana"), "Grafana Loki™ and Grafana®");
  });
  test('"Claude Code" beats "Claude"', () => {
    assert.equal(render("Claude Code uses Claude"), "Claude Code™ uses Claude™");
  });
  test("a shorter alias still matches on its own", () => {
    assert.equal(render("Loki, then Grafana Loki"), "Loki™, then Grafana Loki");
  });
});

describe("case sensitivity", () => {
  test("case-sensitive by default: the noun 'thread' is not the Thread mark", () => {
    // A case-insensitive keyword match is how a site ends up showing a
    // Thread® notice on every page that says "thread pool".
    assert.deepEqual(names(findTrademarks("Each thread in the pool waits.", MARKS)), []);
    assert.equal(render("Each thread in the pool waits."), "Each thread in the pool waits.");
    assert.equal(noticesForText("Built on Thread.", [THREAD], { catchAll: false }).length, 1);
    assert.deepEqual(noticesForText("a thread and a THREAD", [THREAD]), []);
  });

  test("caseSensitive: false matches every casing — the hazard, made explicit", () => {
    const loose = defineTrademarks([{ ...THREAD, caseSensitive: false }]);
    assert.equal(findTrademarks("each thread waits", loose).length, 1);
  });

  test("case-insensitive and case-sensitive marks combine, longest first", () => {
    const marks = defineTrademarks([
      { name: "Wi-Fi", aliases: ["Wi-Fi", "WiFi"], symbol: "®", caseSensitive: false },
      { name: "Wi-Fi CERTIFIED", symbol: "™" },
    ]);
    assert.deepEqual(names(findTrademarks("wifi and Wi-Fi CERTIFIED", marks)), [
      "Wi-Fi",
      "Wi-Fi CERTIFIED",
    ]);
  });
});

describe("markFirstMentions", () => {
  test("only the first mention gets the symbol", () => {
    assert.equal(render("ClickHouse and ClickHouse"), "ClickHouse® and ClickHouse");
  });

  test("a shared Set makes the page, not the string, the unit", () => {
    const marked = new Set<Trademark>();
    assert.equal(render("ClickHouse first", marked), "ClickHouse® first");
    assert.equal(render("ClickHouse second", marked), "ClickHouse second");
  });

  test("a mention already carrying a symbol counts as marked", () => {
    assert.equal(render("ClickHouse® then ClickHouse"), "ClickHouse® then ClickHouse");
    assert.equal(render("Docker™ then Docker"), "Docker™ then Docker");
  });

  test("triggers are never marked and do not use up the mark", () => {
    assert.equal(render("Over BLE, then Bluetooth"), "Over BLE, then Bluetooth®");
  });

  test("nothing to mark: one run, no mark", () => {
    assert.deepEqual(markFirstMentions("plain", MARKS), [{ text: "plain" }]);
    assert.deepEqual(markFirstMentions("", MARKS), [{ text: "" }]);
  });
});

describe("findTrademarks", () => {
  test("order of first appearance, deduped, triggers included", () => {
    assert.deepEqual(names(findTrademarks("BLE, Docker, ClickHouse, Docker", MARKS)), [
      "Bluetooth",
      "Docker",
      "ClickHouse",
    ]);
  });
});

describe("trademarkNotices", () => {
  test("one sentence per owner; registered only when every mark is ®", () => {
    assert.deepEqual(trademarkNotices([K8S, NATS], MARKS), [
      "NATS™ and Kubernetes® are trademarks of The Linux Foundation.",
    ]);
    assert.deepEqual(trademarkNotices([K8S], MARKS), [
      "Kubernetes® is a registered trademark of The Linux Foundation.",
    ]);
    assert.deepEqual(trademarkNotices([NATS], MARKS), [
      "NATS™ is a trademark of The Linux Foundation.",
    ]);
  });

  test("owners in page order; marks inside an owner in registry order", () => {
    assert.deepEqual(trademarkNotices([LOKI, CH, GRAFANA], MARKS), [
      "Grafana® and Grafana Loki™ are trademarks of Grafana Labs.",
      "ClickHouse® is a registered trademark of ClickHouse, Inc.",
    ]);
  });

  test("serial comma for three or more", () => {
    const a: Trademark = { name: "A", symbol: "®", owner: "O" };
    const b: Trademark = { name: "B", symbol: "®", owner: "O" };
    const c: Trademark = { name: "C", symbol: "®", owner: "O" };
    assert.deepEqual(trademarkNotices([a, b, c]), [
      "A®, B®, and C® are registered trademarks of O.",
    ]);
  });

  test("does not double the period after Inc.", () => {
    assert.deepEqual(trademarkNotices([DOCKER]), [
      "Docker® is a registered trademark of Docker, Inc.",
    ]);
  });

  test("qualifier: plain and comma-led", () => {
    const q: Trademark = { ...K8S, qualifier: "in the U.S. and other countries" };
    assert.deepEqual(trademarkNotices([q]), [
      "Kubernetes® is a registered trademark of The Linux Foundation in the U.S. and other countries.",
    ]);
    const apple: Trademark[] = [
      {
        name: "Apple",
        symbol: "™",
        owner: "Apple Inc.",
        qualifier: ", registered in the U.S. and other countries",
      },
      {
        name: "macOS",
        symbol: "™",
        owner: "Apple Inc.",
        qualifier: ", registered in the U.S. and other countries",
      },
    ];
    assert.deepEqual(trademarkNotices(apple), [
      "Apple™ and macOS™ are trademarks of Apple Inc., registered in the U.S. and other countries.",
    ]);
  });

  test("licensed: true and a named licensee", () => {
    const ios: Trademark = {
      name: "IOS",
      symbol: "™",
      owner: "Cisco",
      qualifier: "in the U.S. and other countries",
      licensed: true,
    };
    assert.deepEqual(trademarkNotices([ios]), [
      "IOS™ is a trademark of Cisco in the U.S. and other countries and is used under license.",
    ]);
    assert.deepEqual(trademarkNotices([BT]), [
      "Bluetooth® is a registered trademark of Bluetooth SIG, Inc., and any use of such mark by Example Corp. is under license.",
    ]);
  });

  test("licensing never leaks onto another mark of the same owner", () => {
    const own: Trademark = {
      name: "Bluetooth LE Audio",
      symbol: "™",
      owner: "Bluetooth SIG, Inc.",
    };
    assert.deepEqual(trademarkNotices([BT, own]), [
      "Bluetooth® is a registered trademark of Bluetooth SIG, Inc., and any use of such mark by Example Corp. is under license.",
      "Bluetooth LE Audio™ is a trademark of Bluetooth SIG, Inc.",
    ]);
  });

  test("a verbatim notice stands alone, even beside a same-owner mark", () => {
    const linux: Trademark = {
      name: "Linux",
      symbol: "®",
      owner: "The Linux Foundation",
      notice:
        "Linux® is the registered trademark of Linus Torvalds in the U.S. and other countries.",
    };
    assert.deepEqual(trademarkNotices([K8S, linux]), [
      "Kubernetes® is a registered trademark of The Linux Foundation.",
      "Linux® is the registered trademark of Linus Torvalds in the U.S. and other countries.",
    ]);
  });

  test("marks sharing one verbatim notice share one line", () => {
    const wording =
      "Apple, macOS, and App Store are trademarks of Apple Inc., registered in the U.S. and other countries.";
    const apple: Trademark = { name: "Apple", symbol: "™", owner: "Apple Inc.", notice: wording };
    const macos: Trademark = { name: "macOS", symbol: "™", owner: "Apple Inc.", notice: wording };
    assert.deepEqual(trademarkNotices([macos, DOCKER, apple]), [
      wording,
      "Docker® is a registered trademark of Docker, Inc.",
    ]);
  });

  test("marks without an owner produce no sentence", () => {
    assert.deepEqual(trademarkNotices([{ name: "Acme", symbol: "™" }]), []);
  });
});

describe("links", () => {
  const CH_L: Trademark = { ...CH, link: "https://clickhouse.example" };
  const G_L: Trademark = { ...GRAFANA, link: "https://grafana.example" };
  const LOKI_SAME: Trademark = { ...LOKI, link: "https://grafana.example" };
  const LOKI_OWN: Trademark = { ...LOKI, link: "https://grafana.example/loki" };

  test("rejects anything but an absolute http(s) URL", () => {
    for (const link of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      " javascript:alert(1)",
      "data:text/html,<b>x</b>",
      "vbscript:x",
      "ftp://example.com",
      "/relative",
      "//example.com",
      "https:example.com",
      'https://example.com/"onmouseover="x',
      "https://example.com/<script>",
      "https://exa mple.com",
      "",
    ]) {
      assert.throws(
        () => defineTrademarks([{ name: "X", symbol: "™", owner: "O", link }]),
        /link must be an absolute http: or https: URL/,
        link
      );
    }
    assert.doesNotThrow(() =>
      defineTrademarks([
        { name: "X", symbol: "™", owner: "O", link: "https://example.com/a?b=1&c=2#d" },
        { name: "Y", symbol: "™", owner: "O", link: "http://example.com" },
      ])
    );
  });

  test("plain-text notice: the bare URL after the sentence", () => {
    assert.deepEqual(trademarkNotices([CH_L]), [
      "ClickHouse® is a registered trademark of ClickHouse, Inc. https://clickhouse.example",
    ]);
  });

  test("one owner group: identical URLs once, distinct URLs in mark order", () => {
    const registry = [CH_L, G_L, LOKI_SAME, LOKI_OWN];
    assert.deepEqual(trademarkNoticeEntries([LOKI_SAME, G_L], registry), [
      {
        text: "Grafana® and Grafana Loki™ are trademarks of Grafana Labs.",
        links: ["https://grafana.example"],
      },
    ]);
    assert.deepEqual(trademarkNoticeEntries([LOKI_OWN, G_L], registry)[0]?.links, [
      "https://grafana.example",
      "https://grafana.example/loki",
    ]);
  });

  test("a verbatim notice keeps its link", () => {
    const m: Trademark = {
      name: "Z",
      symbol: "®",
      notice: "Z® is theirs.",
      link: "https://z.example",
    };
    assert.deepEqual(trademarkNotices([m]), ["Z® is theirs. https://z.example"]);
  });

  test("an ownerless mark's link is ignored", () => {
    assert.deepEqual(
      trademarkNotices([{ name: "Acme", symbol: "™", link: "https://acme.example" }]),
      []
    );
  });

  test("noticesForText: bare URL in text, autolink in markdown", () => {
    const marks = defineTrademarks([CH_L]);
    assert.deepEqual(noticesForText("ClickHouse", marks, { catchAll: false }), [
      "ClickHouse® is a registered trademark of ClickHouse, Inc. https://clickhouse.example",
    ]);
    assert.deepEqual(noticesForText("ClickHouse", marks, { catchAll: false, markdown: true }), [
      "ClickHouse® is a registered trademark of ClickHouse, Inc. <https://clickhouse.example>",
    ]);
  });
});

describe("noticesForText", () => {
  test("notices plus the catch-all; [] when nothing is named", () => {
    assert.deepEqual(noticesForText("Runs on ClickHouse.", MARKS), [
      "ClickHouse® is a registered trademark of ClickHouse, Inc.",
      DEFAULT_CATCH_ALL,
    ]);
    assert.deepEqual(noticesForText("Nothing here.", MARKS), []);
  });

  test("catchAll: false and a custom catch-all", () => {
    assert.deepEqual(noticesForText("Docker", MARKS, { catchAll: false }), [
      "Docker® is a registered trademark of Docker, Inc.",
    ]);
    assert.equal(
      noticesForText("Docker", MARKS, { catchAll: "Others: theirs." }).at(-1),
      "Others: theirs."
    );
  });

  test("markdown: code fences and inline code do not count", () => {
    const md =
      "Use `Docker` here.\n\n```sh\nClickHouse\n```\n\n~~~\nGrafana\n~~~\n\nThen Kubernetes.";
    assert.deepEqual(names(findTrademarks(stripMarkdownCode(md), MARKS)), ["Kubernetes"]);
    assert.equal(noticesForText(md, MARKS, { markdown: true, catchAll: false }).length, 1);
    assert.equal(noticesForText(md, MARKS, { catchAll: false }).length, 4);
  });
});
