export const GET = () =>
  new Response("# ClickHouse\n\nGrafana reads `Docker` logs.\n", {
    headers: { "content-type": "text/markdown; charset=utf-8" },
  });
