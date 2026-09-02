/**
 * Production server for Agent Town (npx / standalone).
 *
 * Reads the Next.js config from the standalone build output and creates
 * an HTTP server with Next.js request handler + WebSocket proxy.
 */

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { attachWsProxy } from "./lib/ws-proxy.mjs";
import { attachAuggieBridge } from "./lib/auggie-bridge.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const isProd = process.env.NODE_ENV === "production";
const prefix = "[Server]";
const log = {
  info: isProd ? () => {} : console.info.bind(console, prefix),
  error: console.error.bind(console, prefix),
};

// Load standalone config before importing next
const requiredServerFiles = JSON.parse(
  readFileSync(join(__dirname, ".next", "required-server-files.json"), "utf-8"),
);
process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(requiredServerFiles.config);

const { default: next } = await import("next");
const { WebSocket, WebSocketServer } = await import("ws");

const port = parseInt(process.env.PORT ?? "3000", 10);
const GATEWAY_URL = process.env.GATEWAY_URL ?? "ws://127.0.0.1:18789/";
const AGENT_PROVIDER = process.env.AGENT_PROVIDER ?? "openclaw";

process.chdir(__dirname);
const app = next({ dev: false, dir: __dirname });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    const server = createServer((req, res) => {
      handle(req, res);
    });

    if (AGENT_PROVIDER === "auggie") {
      attachAuggieBridge(server, WebSocket, WebSocketServer);
    } else {
      attachWsProxy(server, WebSocket, WebSocketServer, GATEWAY_URL);
    }

    server.listen(port, () => {
      log.info("");
      log.info("  \x1b[36m\x1b[1mOffice Live 小剧场\x1b[0m is running!");
      log.info("");
      log.info(`  > Local:   \x1b[4mhttp://localhost:${port}\x1b[0m`);
      if (AGENT_PROVIDER === "auggie") {
        log.info("  > Provider: Auggie (bridging via auggie CLI)");
      } else {
        log.info(`  > Gateway: ${GATEWAY_URL}`);
      }
      log.info("");
    });
  })
  .catch((err) => {
    log.error("Failed to start Agent Town:", err);
    process.exit(1);
  });
