// Fixture registry as plain data. Fixture wording only — not legal claims.
// Shared by the site (through defineTrademarks) and by the test oracle, which
// must not depend on the package it checks.
export default [
  {
    name: "ClickHouse",
    symbol: "®",
    owner: "ClickHouse, Inc.",
    link: "https://clickhouse.example/?ref=a&b=1",
  },
  { name: "Grafana", symbol: "®", owner: "Grafana Labs", link: "https://grafana.example" },
  {
    name: "Grafana Loki",
    aliases: ["Grafana Loki", "Loki"],
    symbol: "™",
    owner: "Grafana Labs",
    link: "https://grafana.example",
  },
  { name: "Kubernetes", symbol: "®", owner: "The Linux Foundation" },
  {
    name: "Bluetooth",
    symbol: "®",
    owner: "Bluetooth SIG, Inc.",
    triggers: ["BLE"],
    licensed: "Example Corp.",
  },
  { name: "Thread", symbol: "®", owner: "Thread Group, Inc." },
  { name: "Docker", symbol: "®", owner: "Docker, Inc." },
  { name: "Acme Widget", symbol: "™" },
];
