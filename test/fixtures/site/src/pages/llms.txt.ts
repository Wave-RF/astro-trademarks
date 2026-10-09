export const GET = () =>
  new Response("Docs for ClickHouse and Grafana.\n", {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
