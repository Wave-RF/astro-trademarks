// The middleware logic, separate from the entrypoint so it can be built and
// tested without Astro's virtual modules.

import type { MiddlewareHandler } from "astro";
import { noticesForText } from "./core.ts";
import { transformHtml } from "./html.ts";
import {
  type ResolvedTrademarksOptions,
  resolveOptions,
  type TrademarksOptions,
} from "./options.ts";

function mediaType(response: Response): string {
  return (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

function rebuild(response: Response, body: string): Response {
  const headers = new Headers(response.headers);
  // The body changed length; a stale Content-Length would truncate it.
  headers.delete("content-length");
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function isResolved(
  o: TrademarksOptions | ResolvedTrademarksOptions
): o is ResolvedTrademarksOptions {
  return Array.isArray((o as ResolvedTrademarksOptions).skipTags) && "onDemand" in o;
}

/**
 * Apply the trademark pass to one response:
 *
 * - `text/html`: mark first mentions inside the content root(s) and fill the
 *   notices placeholder from the same scan.
 * - `text/markdown` / `text/plain`: untouched unless `machineReadable` opts
 *   in, in which case attribution lines are appended.
 * - anything else, or a response with no body: returned as-is.
 */
export async function transformResponse(
  response: Response,
  options: TrademarksOptions | ResolvedTrademarksOptions
): Promise<Response> {
  const o = isResolved(options) ? options : resolveOptions(options);
  if (!response.body) return response;
  const type = mediaType(response);

  if (type === "text/html") {
    const html = await response.text();
    const { html: out } = transformHtml(html, o);
    return rebuild(response, out);
  }

  const wantsMarkdown = type === "text/markdown" && o.machineReadable.markdown;
  const wantsPlain = type === "text/plain" && o.machineReadable.plain;
  if (wantsMarkdown || wantsPlain) {
    const text = await response.text();
    const lines = noticesForText(text, o.marks, {
      markdown: wantsMarkdown,
      catchAll: o.machineReadable.catchAll,
    });
    if (lines.length === 0) return rebuild(response, text);
    const sep = text.endsWith("\n") ? "\n" : "\n\n";
    return rebuild(response, `${text}${sep}${lines.join(" ")}\n`);
  }
  return response;
}

/** An Astro middleware handler that runs {@link transformResponse} on every response. */
export function createTrademarksMiddleware(
  options: TrademarksOptions | ResolvedTrademarksOptions
): MiddlewareHandler {
  const o = isResolved(options) ? options : resolveOptions(options);
  return async (context, next) => {
    const response = await next();
    if (!o.onDemand && !context.isPrerendered) return response;
    return transformResponse(response, o);
  };
}
