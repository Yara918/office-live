#!/usr/bin/env node
/**
 * Agent Town MCP Server — stdio-based MCP server for auggie.
 *
 * Exposes a `dispatch_to_worker` tool that lets the LLM delegate tasks to
 * specific workers in Agent Town.  Reads the worker roster from the
 * AGENT_TOWN_WORKERS env var (JSON array) and dispatches via HTTP POST to
 * the internal dispatch endpoint on the Agent Town server.
 *
 * Protocol: JSON-RPC 2.0 over stdin/stdout (MCP stdio transport).
 */

import { createInterface } from "node:readline";

const DISPATCH_URL = `http://127.0.0.1:${process.env.AGENT_TOWN_PORT ?? 3000}/api/internal/dispatch`;
const DISPATCH_SECRET = process.env.AGENT_TOWN_DISPATCH_SECRET ?? "";

let workers = [];
try {
  workers = JSON.parse(process.env.AGENT_TOWN_WORKERS ?? "[]");
} catch {
  /* ignore */
}

function workerListDescription() {
  if (workers.length === 0) return "No workers currently available.";
  return workers
    .map((w) => `• seatId="${w.seatId}" — ${w.label} (${w.roleTitle ?? "Worker"})`)
    .join("\n");
}

function sendResponse(id, result) {
  const msg = JSON.stringify({ jsonrpc: "2.0", id, result });
  process.stdout.write(msg + "\n");
}

function sendError(id, code, message) {
  const msg = JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
  process.stdout.write(msg + "\n");
}

async function handleRequest(req) {
  const { id, method, params } = req;

  switch (method) {
    case "initialize":
      sendResponse(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "agent-town", version: "1.0.0" },
      });
      break;

    case "notifications/initialized":
      // No response needed for notifications
      break;

    case "tools/list":
      sendResponse(id, {
        tools: [
          {
            name: "dispatch_to_worker",
            description: `Dispatch a task to another worker in Agent Town. The worker will execute the task independently and return the result. Use this to delegate work to team members based on their specialty.\n\nAvailable workers:\n${workerListDescription()}`,
            inputSchema: {
              type: "object",
              properties: {
                seatId: {
                  type: "string",
                  description: "The seatId of the target worker (from the list above)",
                },
                task: {
                  type: "string",
                  description: "The task description / instruction for the worker",
                },
              },
              required: ["seatId", "task"],
            },
          },
        ],
      });
      break;

    case "tools/call": {
      const toolName = params?.name;
      if (toolName !== "dispatch_to_worker") {
        sendError(id, -32601, `Unknown tool: ${toolName}`);
        return;
      }
      const { seatId, task } = params?.arguments ?? {};
      if (!seatId || !task) {
        sendResponse(id, {
          content: [{ type: "text", text: "Error: seatId and task are required" }],
          isError: true,
        });
        return;
      }
      try {
        const res = await fetch(DISPATCH_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(DISPATCH_SECRET ? { "x-dispatch-secret": DISPATCH_SECRET } : {}),
          },
          body: JSON.stringify({ seatId, task }),
        });
        const data = await res.json();
        if (!res.ok) {
          sendResponse(id, {
            content: [{ type: "text", text: `Dispatch failed: ${data.error ?? res.statusText}` }],
            isError: true,
          });
          return;
        }
        sendResponse(id, {
          content: [{ type: "text", text: data.result ?? "Task completed (no output)" }],
        });
      } catch (err) {
        sendResponse(id, {
          content: [{ type: "text", text: `Dispatch error: ${err.message}` }],
          isError: true,
        });
      }
      break;
    }

    default:
      if (id !== undefined) {
        sendError(id, -32601, `Method not found: ${method}`);
      }
      break;
  }
}

// Read JSON-RPC messages from stdin (one per line)
const rl = createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  try {
    const req = JSON.parse(line);
    handleRequest(req).catch((err) => {
      if (req.id !== undefined) sendError(req.id, -32603, err.message);
    });
  } catch {
    /* ignore malformed lines */
  }
});
