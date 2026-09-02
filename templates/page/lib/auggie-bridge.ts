/**
 * Auggie Bridge — emulates the OpenClaw gateway protocol but delegates to the
 * `auggie` CLI for actual agent execution.
 *
 * Handles WebSocket upgrades, the connect/challenge handshake, chat send/abort,
 * session listing, and model listing by spawning `auggie` child processes.
 */

import { type IncomingMessage } from "http";
import type { Duplex } from "stream";
import { spawn, type ChildProcess } from "child_process";
import { writeFileSync, mkdirSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { WebSocket, WebSocketServer } from "ws";
import { createLogger } from "./logger";

const log = createLogger("Auggie Bridge");

let runCounter = 0;

/** Lightweight seat info passed to MCP server and prompt context. */
interface WorkerInfo {
  seatId: string;
  label: string;
  roleTitle?: string;
}

/** Module-level state so the dispatch endpoint can find active clients. */
let activeClientState: ClientState | null = null;
let workerRoster: WorkerInfo[] = [];

interface GatewayFrame {
  type: "req" | "res" | "event";
  id?: string;
  method?: string;
  params?: Record<string, unknown>;
  ok?: boolean;
  payload?: Record<string, unknown>;
  error?: { code: string; message: string; retryable?: boolean };
  event?: string;
  seq?: number;
}

interface ClientState {
  ws: WebSocket;
  seq: number;
  runningProcesses: Map<string, ChildProcess>;
  /** Maps OpenClaw sessionKey → Auggie session_id for resume support */
  sessionMap: Map<string, string>;
}

// ── Helpers ─────────────────────────────────────────────

function sendFrame(state: ClientState, frame: GatewayFrame) {
  if (state.ws.readyState !== WebSocket.OPEN) return;
  try {
    state.ws.send(JSON.stringify(frame));
  } catch (err) {
    log.error("sendFrame failed:", (err as Error).message);
  }
}

function sendEvent(state: ClientState, event: string, payload: Record<string, unknown>) {
  sendFrame(state, { type: "event", event, payload, seq: state.seq++ });
}

function sendResponse(
  state: ClientState,
  id: string,
  ok: boolean,
  payloadOrError: Record<string, unknown>,
) {
  const frame: GatewayFrame = { type: "res", id, ok };
  if (ok) {
    frame.payload = payloadOrError;
  } else {
    frame.error = payloadOrError as GatewayFrame["error"];
  }
  sendFrame(state, frame);
}

/**
 * Parse JSON from auggie stdout. The CLI may emit non-JSON diagnostic lines
 * before the actual JSON object, so we search for the first `{` and try to
 * parse from there.
 */
function parseAuggieOutput(raw: string): Record<string, unknown> | null {
  const idx = raw.indexOf("{");
  if (idx === -1) return null;
  try {
    return JSON.parse(raw.slice(idx)) as Record<string, unknown>;
  } catch {
    // Try line-by-line in case there's trailing output after the JSON
    const lines = raw.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line.startsWith("{")) {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }
      }
    }
    return null;
  }
}

// ── Origin check (same pattern as ws-proxy.ts) ─────────

function checkOrigin(req: IncomingMessage, socket: Duplex): boolean {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== host) {
        log.warn(`Rejected WS upgrade: origin ${origin} does not match host ${host}`);
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return false;
      }
    } catch {
      log.warn(`Rejected WS upgrade: invalid origin ${origin}`);
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return false;
    }
  }
  return true;
}

// ── Chat send handler ──────────────────────────────────

function buildWorkerRosterContext(currentSeatLabel?: string): string {
  if (workerRoster.length <= 1) return "";
  const others = workerRoster.filter((w) => w.label !== currentSeatLabel);
  if (others.length === 0) return "";
  const lines = others.map(
    (w) => `  • seatId="${w.seatId}" — ${w.label} (${w.roleTitle ?? "Worker"})`,
  );
  return (
    "\n\nYou have team members available. Use the dispatch_to_worker tool to delegate tasks:\n" +
    lines.join("\n") +
    "\n"
  );
}

function buildPersonalityPrefix(params: Record<string, unknown>): string {
  const label = params.seatLabel as string | undefined;
  const role = params.seatRole as string | undefined;
  if (!label && !role) return "[You are powered by Auggie. Stay in character when responding.]\n\n";
  const parts: string[] = [];
  if (label) parts.push(`Your name is "${label}".`);
  if (role) parts.push(`Your role is ${role}.`);
  parts.push("Stay in character when responding.");
  const rosterCtx = buildWorkerRosterContext(label);
  return `[${parts.join(" ")}${rosterCtx}]\n\n`;
}

function handleChatSend(state: ClientState, id: string, params: Record<string, unknown>) {
  const sessionKey = (params.sessionKey as string) ?? "default";
  const rawMessage = (params.message as string) ?? "";
  const runId = `auggie_${Date.now()}_${++runCounter}`;

  // Inject personality context from seat config
  const message = buildPersonalityPrefix(params) + rawMessage;

  // Immediate response with runId
  sendResponse(state, id, true, { runId, status: "accepted" });

  // Lifecycle start
  sendEvent(state, "agent", { runId, sessionKey, stream: "lifecycle", data: { phase: "start" } });

  // Build auggie command args
  const args = ["--print", "--output-format", "json"];

  // Attach MCP server for worker dispatch if we have a roster
  const mcpConfigPath = writeMcpConfig();
  if (mcpConfigPath) {
    args.push("--mcp-config", mcpConfigPath);
  }

  const existingSessionId = state.sessionMap.get(sessionKey);
  if (existingSessionId) {
    args.push("--resume", existingSessionId);
  }

  args.push("--");
  args.push(message);

  log.info(`Spawning auggie for run ${runId}:`, ["auggie", ...args].join(" "));

  const port = process.env.PORT ?? "3000";
  let child: ChildProcess;
  try {
    child = spawn("auggie", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        AGENT_TOWN_PORT: port,
        AGENT_TOWN_WORKERS: JSON.stringify(workerRoster),
        AGENT_TOWN_DISPATCH_SECRET: dispatchSecret,
      },
    });
  } catch (err) {
    const errMsg = `Failed to spawn auggie: ${(err as Error).message}`;
    log.error(errMsg);
    sendEvent(state, "agent", {
      runId,
      sessionKey,
      stream: "lifecycle",
      data: { phase: "error", error: errMsg },
    });
    sendEvent(state, "chat", { runId, sessionKey, state: "error" });
    return;
  }

  state.runningProcesses.set(runId, child);

  let stdout = "";
  let stderr = "";

  child.stdout!.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });

  child.stderr!.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  child.on("error", (err) => {
    log.error(`auggie process error for run ${runId}:`, err.message);
    state.runningProcesses.delete(runId);
    sendEvent(state, "agent", {
      runId,
      sessionKey,
      stream: "lifecycle",
      data: { phase: "error", error: err.message },
    });
    sendEvent(state, "chat", { runId, sessionKey, state: "error" });
  });

  child.on("close", (code) => {
    state.runningProcesses.delete(runId);

    if (code === null || code !== 0) {
      const errMsg = stderr.trim() || `auggie exited with code ${code}`;
      log.error(`auggie failed for run ${runId}:`, errMsg);
      sendEvent(state, "agent", {
        runId,
        sessionKey,
        stream: "lifecycle",
        data: { phase: "error", error: errMsg },
      });
      sendEvent(state, "chat", { runId, sessionKey, state: "error" });
      return;
    }

    const parsed = parseAuggieOutput(stdout);
    if (!parsed) {
      log.error(`auggie produced unparseable output for run ${runId}:`, stdout.slice(0, 500));
      sendEvent(state, "agent", {
        runId,
        sessionKey,
        stream: "lifecycle",
        data: { phase: "error", error: "Failed to parse auggie output" },
      });
      sendEvent(state, "chat", { runId, sessionKey, state: "error" });
      return;
    }

    // Store auggie session_id for future resume
    if (typeof parsed.session_id === "string") {
      state.sessionMap.set(sessionKey, parsed.session_id);
      log.debug(`Mapped sessionKey ${sessionKey} → auggie session ${parsed.session_id}`);
    }

    const responseText =
      typeof parsed.result === "string"
        ? parsed.result
        : typeof parsed.response === "string"
          ? parsed.response
          : JSON.stringify(parsed);

    // Lifecycle end
    sendEvent(state, "agent", {
      runId,
      sessionKey,
      stream: "lifecycle",
      data: { phase: "end" },
    });

    // Final chat message
    sendEvent(state, "chat", {
      runId,
      sessionKey,
      state: "final",
      message: { content: [{ type: "text", text: responseText }] },
    });

    log.info(`Run ${runId} completed successfully`);
  });
}

// ── Chat abort handler ─────────────────────────────────

function handleChatAbort(state: ClientState, id: string, params: Record<string, unknown>) {
  const runId = params.runId as string | undefined;
  const sessionKey = (params.sessionKey as string) ?? "default";

  if (runId && state.runningProcesses.has(runId)) {
    const child = state.runningProcesses.get(runId)!;
    child.kill("SIGTERM");
    state.runningProcesses.delete(runId);
    log.info(`Aborted run ${runId}`);
  }

  sendResponse(state, id, true, {});
  if (runId) {
    sendEvent(state, "chat", { runId, sessionKey, state: "aborted" });
  }
}

// ── Models list handler ────────────────────────────────

async function handleModelsList(state: ClientState, id: string) {
  try {
    const result = await new Promise<string>((resolve, reject) => {
      const child = spawn("auggie", ["model", "list", "--json"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "";
      child.stdout!.on("data", (chunk: Buffer) => {
        out += chunk.toString();
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve(out);
        else reject(new Error(`auggie model list exited with code ${code}`));
      });
      // Timeout after 10s
      setTimeout(() => {
        child.kill();
        reject(new Error("timeout"));
      }, 10_000);
    });

    const parsed = parseAuggieOutput(result);
    if (parsed && Array.isArray(parsed.models)) {
      sendResponse(state, id, true, { models: parsed.models });
      return;
    }
    // Try treating the whole output as an array
    const idx = result.indexOf("[");
    if (idx !== -1) {
      try {
        const arr = JSON.parse(result.slice(idx));
        if (Array.isArray(arr)) {
          sendResponse(state, id, true, { models: arr });
          return;
        }
      } catch {
        /* fall through */
      }
    }
  } catch (err) {
    log.warn("Failed to list auggie models:", (err as Error).message);
  }

  // Static fallback
  sendResponse(state, id, true, {
    models: [{ id: "default", provider: "auggie", contextWindow: 128000 }],
  });
}

// ── Client message router ──────────────────────────────

function handleMessage(state: ClientState, raw: string) {
  let frame: GatewayFrame;
  try {
    frame = JSON.parse(raw) as GatewayFrame;
  } catch {
    log.warn("Received non-JSON message, ignoring");
    return;
  }

  if (frame.type !== "req") {
    log.debug("Ignoring non-request frame:", frame.type);
    return;
  }

  const { id, method, params } = frame;
  if (!id || !method) {
    log.warn("Request frame missing id or method");
    return;
  }

  log.debug(`Request: ${method} (id=${id})`);

  switch (method) {
    case "connect":
      // Respond with hello-ok, ignoring the auth token
      sendResponse(state, id, true, {
        type: "hello-ok",
        scopes: ["operator.read", "operator.write"],
      });
      break;

    case "chat.send":
      handleChatSend(state, id, params ?? {});
      break;

    case "chat.abort":
      handleChatAbort(state, id, params ?? {});
      break;

    case "sessions.list":
      sendResponse(state, id, true, { sessions: [] });
      break;

    case "sessions.preview":
      sendResponse(state, id, true, { previews: [] });
      break;

    case "models.list":
      void handleModelsList(state, id);
      break;

    default:
      log.warn(`Unknown method: ${method}`);
      sendResponse(state, id, false, {
        code: "unknown_method",
        message: `Unknown method: ${method}`,
      });
      break;
  }
}

// ── MCP config helpers ────────────────────────────────

const dispatchSecret = `at_${Date.now()}_${Math.random().toString(36).slice(2)}`;
let mcpConfigPath: string | null = null;

function getMcpServerPath(): string {
  // Resolve the MCP server script relative to the project root.
  // In dev (tsx) process.cwd() is the project root; in prod the server
  // is started from the package root.  Either way, lib/mcp/ lives there.
  return join(process.cwd(), "lib", "mcp", "agent-town-mcp.mjs");
}

/** Write (or reuse) a temporary MCP config file pointing at our stdio server. */
function writeMcpConfig(): string | null {
  if (workerRoster.length <= 1) return null; // No point dispatching with 0-1 workers
  if (mcpConfigPath) return mcpConfigPath;
  try {
    const config = {
      mcpServers: {
        "agent-town": {
          command: "node",
          args: [getMcpServerPath()],
        },
      },
    };
    const dir = join(tmpdir(), "agent-town-mcp");
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, `mcp-config-${process.pid}.json`);
    writeFileSync(filePath, JSON.stringify(config), "utf-8");
    mcpConfigPath = filePath;
    log.info(`MCP config written to ${filePath}`);
    return filePath;
  } catch (err) {
    log.warn("Failed to write MCP config:", (err as Error).message);
    return null;
  }
}

function cleanupMcpConfig() {
  if (mcpConfigPath) {
    try {
      unlinkSync(mcpConfigPath);
    } catch {
      /* ignore */
    }
    mcpConfigPath = null;
  }
}

// ── Dispatch handler (called from HTTP endpoint) ──────

/**
 * Dispatch a task to a specific worker seat, spawning a new auggie process.
 * Returns the result text. Emits subagent-like lifecycle events so the
 * frontend shows the task animation on the target worker.
 */
export function dispatchToWorker(
  seatId: string,
  task: string,
): Promise<{ result: string; error?: string }> {
  return new Promise((resolve) => {
    const state = activeClientState;
    const seat = workerRoster.find((w) => w.seatId === seatId);
    if (!state || state.ws.readyState !== WebSocket.OPEN) {
      resolve({ result: "", error: "No active WebSocket client" });
      return;
    }
    if (!seat) {
      resolve({ result: "", error: `Unknown seatId: ${seatId}` });
      return;
    }

    const runId = `auggie_sub_${Date.now()}_${++runCounter}`;
    const sessionKey = `subagent:dispatch:${seatId}:${runId}`;

    // Build personality for the target worker
    const prefix = buildPersonalityPrefix({
      seatLabel: seat.label,
      seatRole: seat.roleTitle,
    });
    const message = prefix + task;

    // Emit lifecycle start so frontend assigns to the target worker
    sendEvent(state, "agent", {
      runId,
      sessionKey,
      stream: "lifecycle",
      data: { phase: "start", label: `${seat.label}: ${task.slice(0, 40)}`, seatId },
    });

    const args = ["--print", "--output-format", "json"];

    // Resume existing session for this seat if available
    const seatSessionKey = `dispatch:${seatId}`;
    const existingSessionId = state.sessionMap.get(seatSessionKey);
    if (existingSessionId) {
      args.push("--resume", existingSessionId);
    }

    args.push("--");
    args.push(message);

    log.info(`Dispatching to ${seat.label} (${seatId}), run ${runId}`);

    let child: ChildProcess;
    try {
      child = spawn("auggie", args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
      });
    } catch (err) {
      const errMsg = `Failed to spawn auggie for dispatch: ${(err as Error).message}`;
      log.error(errMsg);
      sendEvent(state, "agent", {
        runId,
        sessionKey,
        stream: "lifecycle",
        data: { phase: "error", error: errMsg },
      });
      resolve({ result: "", error: errMsg });
      return;
    }

    let stdout = "";
    let stderr = "";

    child.stdout!.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      log.error(`dispatch process error for run ${runId}:`, err.message);
      sendEvent(state, "agent", {
        runId,
        sessionKey,
        stream: "lifecycle",
        data: { phase: "error", error: err.message },
      });
      resolve({ result: "", error: err.message });
    });

    child.on("close", (code) => {
      if (code !== 0) {
        const errMsg = stderr.trim() || `auggie exited with code ${code}`;
        log.error(`dispatch failed for run ${runId}:`, errMsg);
        sendEvent(state, "agent", {
          runId,
          sessionKey,
          stream: "lifecycle",
          data: { phase: "error", error: errMsg },
        });
        resolve({ result: "", error: errMsg });
        return;
      }

      const parsed = parseAuggieOutput(stdout);
      const responseText = parsed
        ? typeof parsed.result === "string"
          ? parsed.result
          : typeof parsed.response === "string"
            ? parsed.response
            : JSON.stringify(parsed)
        : stdout.trim();

      // Store session for future resume
      if (parsed && typeof parsed.session_id === "string") {
        state.sessionMap.set(seatSessionKey, parsed.session_id);
      }

      // Emit lifecycle end + final chat for frontend
      sendEvent(state, "agent", {
        runId,
        sessionKey,
        stream: "lifecycle",
        data: { phase: "end" },
      });
      sendEvent(state, "chat", {
        runId,
        sessionKey,
        state: "final",
        message: { content: [{ type: "text", text: responseText }] },
      });

      log.info(`Dispatch to ${seat.label} completed (run ${runId})`);
      resolve({ result: responseText });
    });
  });
}

/** Validate the dispatch secret from an HTTP request. */
export function validateDispatchSecret(secret: string): boolean {
  return secret === dispatchSecret;
}

/** Update the worker roster (called when seat configs change). */
export function setWorkerRoster(seats: WorkerInfo[]) {
  workerRoster = seats;
  mcpConfigPath = null; // Force re-generation if roster changes
  log.debug(`Worker roster updated: ${seats.length} workers`);
}

// ── Cleanup ────────────────────────────────────────────

function cleanupClient(state: ClientState) {
  if (activeClientState === state) activeClientState = null;
  for (const [runId, child] of state.runningProcesses) {
    log.info(`Killing orphaned process for run ${runId}`);
    child.kill("SIGTERM");
  }
  state.runningProcesses.clear();
}

// ── Public API ─────────────────────────────────────────

/**
 * Attach the Auggie bridge WebSocket handler to an HTTP server.
 * Intercepts upgrade requests on `path` and handles them with the
 * emulated OpenClaw gateway protocol backed by the `auggie` CLI.
 */
export function attachAuggieBridge(server: import("http").Server, path = "/api/gateway") {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (req.url !== path) return;
    if (!checkOrigin(req, socket)) return;

    wss.handleUpgrade(req, socket, head, (ws) => {
      const state: ClientState = {
        ws,
        seq: 0,
        runningProcesses: new Map(),
        sessionMap: new Map(),
      };

      activeClientState = state;
      log.info("Client connected");

      // Send connect challenge immediately
      sendEvent(state, "connect.challenge", {});

      ws.on("message", (data) => {
        handleMessage(state, data.toString());
      });

      ws.on("close", () => {
        log.info("Client disconnected");
        cleanupClient(state);
      });

      ws.on("error", (err) => {
        log.error("Client WS error:", err.message);
        cleanupClient(state);
      });
    });
  });

  wss.on("error", (err) => {
    log.error("WebSocketServer error:", err.message);
  });

  process.on("exit", cleanupMcpConfig);

  log.info(`Auggie bridge attached on ${path}`);
}
