// The middleware entrypoint the integration registers with `addMiddleware`.
// Its options arrive through a virtual module the integration's Vite plugin
// serves, because an entrypoint is loaded by path and cannot take arguments.

import config from "virtual:@wave-rf/astro-trademarks/config";
import { createTrademarksMiddleware } from "./handler.ts";

export const onRequest = createTrademarksMiddleware(config);
