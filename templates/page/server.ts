/**
 * Custom Next.js dev server with WebSocket proxy.
 *
 * Proxies ws://localhost:3000/api/gateway → ws://GATEWAY_URL
 * so the browser never needs to connect to the gateway directly.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import next from "next";
import { createLogger } from "./lib/logger";
import { attachWsProxy } from "./lib/ws-proxy";
import {
  attachAuggieBridge,
  dispatchToWorker,
  validateDispatchSecret,
  setWorkerRoster,
} from "./lib/auggie-bridge";

const log = createLogger("Server");

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT ?? "3000", 10);
const GATEWAY_URL = process.env.GATEWAY_URL ?? "ws://127.0.0.1:18789/";
const AGENT_PROVIDER = process.env.AGENT_PROVIDER ?? "openclaw";
// Expose provider to Next.js client code (compiled on-demand in dev)
process.env.NEXT_PUBLIC_AGENT_PROVIDER = AGENT_PROVIDER;

const app = next({ dev, webpack: process.env.OFFICE_LIVE_BUNDLER !== "turbopack" });
const handle = app.getRequestHandler();

function listenOnAvailablePort(server: ReturnType<typeof createServer>, startPort: number) {
  return new Promise<number>((resolve, reject) => {
    let current = startPort;
    const tryListen = () => {
      const onError = (err: NodeJS.ErrnoException) => {
        server.off("listening", onListening);
        if (err.code === "EADDRINUSE" && current < startPort + 19) {
          current += 1;
          tryListen();
          return;
        }
        reject(err);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve(current);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(current);
    };
    tryListen();
  });
}

// ── Internal dispatch endpoint for MCP tool → auggie bridge ──

function handleDispatch(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  // Only accept requests from localhost
  const remoteIp = req.socket.remoteAddress;
  if (remoteIp !== "127.0.0.1" && remoteIp !== "::1" && remoteIp !== "::ffff:127.0.0.1") {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Forbidden" }));
    return;
  }

  const secret = req.headers["x-dispatch-secret"] as string | undefined;
  if (!secret || !validateDispatchSecret(secret)) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid dispatch secret" }));
    return;
  }

  let body = "";
  req.on("data", (chunk: Buffer) => {
    body += chunk.toString();
  });
  req.on("end", () => {
    try {
      const { seatId, task } = JSON.parse(body);
      if (!seatId || !task) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "seatId and task are required" }));
        return;
      }

      dispatchToWorker(seatId, task)
        .then((result) => {
          res.writeHead(result.error ? 500 : 200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        })
        .catch((err: Error) => {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        });
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON body" }));
    }
  });
}

// ── Seat config sync for auggie worker roster ──

function handleSeatSync(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") {
    res.writeHead(405);
    res.end();
    return;
  }
  let body = "";
  req.on("data", (chunk: Buffer) => {
    body += chunk.toString();
  });
  req.on("end", () => {
    try {
      const { seats } = JSON.parse(body);
      if (Array.isArray(seats)) {
        setWorkerRoster(
          seats
            .filter((s: { assigned?: boolean }) => s.assigned)
            .map((s: { seatId: string; label: string; roleTitle?: string }) => ({
              seatId: s.seatId,
              label: s.label,
              roleTitle: s.roleTitle,
            })),
        );
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch {
      res.writeHead(400);
      res.end();
    }
  });
}

app
  .prepare()
  .then(() => {
    const server = createServer((req, res) => {
      // Intercept internal API routes before Next.js
      if (AGENT_PROVIDER === "auggie") {
        if (req.url === "/api/internal/dispatch") {
          handleDispatch(req, res);
          return;
        }
        if (req.url === "/api/internal/seat-sync") {
          handleSeatSync(req, res);
          return;
        }
      }
      handle(req, res);
    });

    if (AGENT_PROVIDER === "auggie") {
      attachAuggieBridge(server);
    } else {
      attachWsProxy(server, GATEWAY_URL);
    }

    listenOnAvailablePort(server, port)
      .then((actualPort) => {
        if (actualPort !== port) log.info(`Port ${port} is in use; using http://localhost:${actualPort}`);
        log.info(`Ready on http://localhost:${actualPort}`);
        if (AGENT_PROVIDER === "auggie") {
          log.info(`Provider: Auggie (bridging via auggie CLI)`);
        } else {
          log.info(`Gateway proxy: ws://localhost:${actualPort}/api/gateway → ${GATEWAY_URL}`);
        }
      })
      .catch((err) => {
        log.error("Failed to start local server:", err);
        process.exit(1);
      });
  })
  .catch((err) => {
    log.error("Failed to prepare Next.js:", err);
    process.exit(1);
  });
