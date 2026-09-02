import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import type { HandlerRefs } from "../gateway-handler";

// ── Mocks ───────────────────────────────────────────────
vi.mock("../events", () => ({
  gameEvents: { emit: vi.fn() },
}));

vi.mock("../reducer", () => {
  let _seq = 0;
  return {
    chatId: () => `chat_test_${++_seq}`,
    findTask: vi.fn().mockReturnValue(undefined),
    resolveSeatLabelForTask: vi.fn().mockReturnValue("Agent A"),
    MAIN_SESSION_KEY: "agent:main:main",
  };
});

vi.mock("../logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { wireGatewayClient, loadSessionPreview } from "../gateway-handler";
import { gameEvents } from "../events";
import { findTask, MAIN_SESSION_KEY } from "../reducer";

// ── Helpers ─────────────────────────────────────────────

type Listener = (...args: unknown[]) => void;

function createMockClient() {
  const handlers = new Map<string, Listener>();
  let statusCb: ((s: string) => void) | null = null;
  let finalCb: ((f: unknown) => void) | null = null;

  return {
    status: "connected" as string,
    hasScope: vi.fn().mockReturnValue(true),
    on(event: string, fn: Listener) {
      handlers.set(event, fn);
      return () => handlers.delete(event);
    },
    onStatus(fn: (s: string) => void) {
      statusCb = fn;
      return () => {
        statusCb = null;
      };
    },
    onFinalResponse(fn: (f: unknown) => void) {
      finalCb = fn;
      return () => {
        finalCb = null;
      };
    },
    request: vi.fn().mockResolvedValue({ payload: {} }),
    // test helpers to trigger handlers
    _emit(event: string, payload: unknown) {
      handlers.get(event)?.(payload);
    },
    _emitStatus(s: string) {
      statusCb?.(s);
    },
    _emitFinal(frame: unknown) {
      finalCb?.(frame);
    },
  };
}

function createRefs(overrides: Partial<HandlerRefs> = {}): HandlerRefs {
  const dispatchFn = vi.fn();
  return {
    dispatch: () => dispatchFn,
    tasks: () => [],
    seats: () => [],
    activeSessionKey: () => undefined,
    setActiveSessionKey: vi.fn(),
    seenStarts: new Set(),
    bubbleAccum: new Map(),
    bubbleThrottleTimers: new Map(),
    runActors: new Map(),
    stoppedRunIds: new Set(),
    modelCatalog: { current: null },
    sessionRefreshTimer: { current: null },
    taskCounter: { current: 0 },
    ...overrides,
  };
}

function getDispatch(refs: HandlerRefs) {
  return refs.dispatch() as ReturnType<typeof vi.fn>;
}

function dispatchCalls(refs: HandlerRefs) {
  return getDispatch(refs).mock.calls.map((c) => c[0]);
}

function dispatchCallsOfType(refs: HandlerRefs, type: string) {
  return dispatchCalls(refs).filter((a: { type: string }) => a.type === type);
}

// ── Tests ───────────────────────────────────────────────

describe("wireGatewayClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    (findTask as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Connection status ────────────────────────────────

  describe("connection status", () => {
    it("dispatches SET_CONNECTION on status change", () => {
      const refs = createRefs();
      const client = createMockClient();
      wireGatewayClient(client as never, refs);

      client._emitStatus("connected");
      expect(dispatchCallsOfType(refs, "SET_CONNECTION")).toEqual([
        { type: "SET_CONNECTION", status: "connected" },
      ]);
    });
  });

  // ── Agent lifecycle: start ───────────────────────────

  describe("agent lifecycle — start", () => {
    it("marks start as seen and refreshes session metrics for non-subagent", () => {
      const refs = createRefs();
      const client = createMockClient();
      wireGatewayClient(client as never, refs);

      client._emit("agent", {
        runId: "run-1",
        sessionKey: "agent:main:sess1",
        stream: "lifecycle",
        data: { phase: "start" },
      });

      expect(refs.seenStarts.has("run-1")).toBe(true);
      // Non-subagent start does NOT emit subagent-assigned
      expect(gameEvents.emit).not.toHaveBeenCalledWith(
        "subagent-assigned",
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });

    it("deduplicates start events for the same runId", () => {
      const refs = createRefs();
      const client = createMockClient();
      wireGatewayClient(client as never, refs);

      const payload = {
        runId: "run-1",
        sessionKey: "agent:main:sess1",
        stream: "lifecycle",
        data: { phase: "start" },
      };

      client._emit("agent", payload);
      client._emit("agent", payload);

      // Should only set activeSessionKey once via the first event
      expect(refs.seenStarts.has("run-1")).toBe(true);
    });

    it("handles subagent start — emits subagent-assigned and dispatches seat/chat", () => {
      const refs = createRefs();
      const client = createMockClient();
      wireGatewayClient(client as never, refs);

      client._emit("agent", {
        runId: "sub-1",
        sessionKey: "subagent:abc:123",
        stream: "lifecycle",
        data: { phase: "start", label: "Research" },
      });

      expect(refs.seenStarts.has("sub-1")).toBe(true);
      expect(gameEvents.emit).toHaveBeenCalledWith(
        "subagent-assigned",
        "sub-1",
        "sub-1",
        "Research",
        undefined,
      );

      const assigns = dispatchCallsOfType(refs, "ASSIGN_SEAT");
      expect(assigns).toHaveLength(1);
      expect(assigns[0].taskSnippet).toContain("[Sub]");

      const chats = dispatchCallsOfType(refs, "APPEND_CHAT");
      expect(chats).toHaveLength(1);
      expect(chats[0].message.content).toContain("Subagent started: Research");

      // Actor stored
      expect(refs.runActors.get("sub-1")).toBe("Research");
    });

    it("ignores agent events with no runId", () => {
      const refs = createRefs();
      const client = createMockClient();
      wireGatewayClient(client as never, refs);

      client._emit("agent", {
        stream: "lifecycle",
        data: { phase: "start" },
      });

      expect(refs.seenStarts.size).toBe(0);
      expect(getDispatch(refs)).not.toHaveBeenCalled();
    });
  });

  // ── Agent lifecycle: end ─────────────────────────────

  describe("agent lifecycle — end", () => {
    it("emits task-completed, dispatches seat done + task completed + chat", () => {
      const refs = createRefs();
      refs.seenStarts.add("run-1");
      refs.bubbleAccum.set("run-1", "some text");
      const client = createMockClient();
      wireGatewayClient(client as never, refs);

      client._emit("agent", {
        runId: "run-1",
        stream: "lifecycle",
        data: { phase: "end" },
      });

      expect(gameEvents.emit).toHaveBeenCalledWith("task-completed", "run-1");

      const seatStatuses = dispatchCallsOfType(refs, "SET_SEAT_STATUS");
      expect(seatStatuses).toEqual([{ type: "SET_SEAT_STATUS", runId: "run-1", status: "done" }]);

      const updates = dispatchCallsOfType(refs, "UPDATE_TASK");
      expect(updates).toHaveLength(1);
      expect(updates[0].patch.status).toBe("completed");

      const chats = dispatchCallsOfType(refs, "APPEND_CHAT");
      expect(chats).toHaveLength(1);
      expect(chats[0].message.content).toBe("Task completed");

      // Cleanup
      expect(refs.seenStarts.has("run-1")).toBe(false);
      expect(refs.bubbleAccum.has("run-1")).toBe(false);
    });

    it("silently cleans up stopped runs on end — no dispatches beyond cleanup", () => {
      const refs = createRefs();
      refs.stoppedRunIds.add("run-1");
      refs.seenStarts.add("run-1");
      refs.bubbleAccum.set("run-1", "data");
      const client = createMockClient();
      wireGatewayClient(client as never, refs);

      client._emit("agent", {
        runId: "run-1",
        stream: "lifecycle",
        data: { phase: "end" },
      });

      // No task-completed emitted for stopped runs
      expect(gameEvents.emit).not.toHaveBeenCalledWith("task-completed", "run-1");
      // No SET_SEAT_STATUS or UPDATE_TASK dispatched
      expect(dispatchCallsOfType(refs, "SET_SEAT_STATUS")).toHaveLength(0);
      expect(dispatchCallsOfType(refs, "UPDATE_TASK")).toHaveLength(0);

      // But cleanup still happens
      expect(refs.seenStarts.has("run-1")).toBe(false);
      expect(refs.bubbleAccum.has("run-1")).toBe(false);
      expect(refs.stoppedRunIds.has("run-1")).toBe(false);
    });

    it("treats run as stopped when findTask returns status=stopped", () => {
      (findTask as ReturnType<typeof vi.fn>).mockReturnValue({ status: "stopped" });

      const refs = createRefs();
      refs.seenStarts.add("run-1");
      const client = createMockClient();
      wireGatewayClient(client as never, refs);

      client._emit("agent", {
        runId: "run-1",
        stream: "lifecycle",
        data: { phase: "end" },
      });

      // Stopped path — no task-completed
      expect(gameEvents.emit).not.toHaveBeenCalledWith("task-completed", "run-1");
      expect(dispatchCallsOfType(refs, "SET_SEAT_STATUS")).toHaveLength(0);
    });
  });

  // ── Agent lifecycle: error ───────────────────────────

  describe("agent lifecycle — error", () => {
    it("emits task-failed, dispatches failed status + chat with error message", () => {
      const refs = createRefs();
      refs.seenStarts.add("run-1");
      const client = createMockClient();
      wireGatewayClient(client as never, refs);

      client._emit("agent", {
        runId: "run-1",
        stream: "lifecycle",
        data: { phase: "error", error: "out of memory" },
      });

      expect(gameEvents.emit).toHaveBeenCalledWith("task-failed", "run-1");

      const seatStatuses = dispatchCallsOfType(refs, "SET_SEAT_STATUS");
      expect(seatStatuses[0].status).toBe("failed");

      const updates = dispatchCallsOfType(refs, "UPDATE_TASK");
      expect(updates[0].patch.status).toBe("failed");

      const chats = dispatchCallsOfType(refs, "APPEND_CHAT");
      expect(chats[0].message.content).toBe("Task error: out of memory");
    });

    it("uses 'unknown' when error field is missing", () => {
      const refs = createRefs();
      const client = createMockClient();
      wireGatewayClient(client as never, refs);

      client._emit("agent", {
        runId: "run-1",
        stream: "lifecycle",
        data: { phase: "error" },
      });

      const chats = dispatchCallsOfType(refs, "APPEND_CHAT");
      expect(chats[0].message.content).toBe("Task error: unknown");
    });

    it("silently cleans up stopped runs on error", () => {
      const refs = createRefs();
      refs.stoppedRunIds.add("run-1");
      const client = createMockClient();
      wireGatewayClient(client as never, refs);

      client._emit("agent", {
        runId: "run-1",
        stream: "lifecycle",
        data: { phase: "error", error: "boom" },
      });

      expect(gameEvents.emit).not.toHaveBeenCalledWith("task-failed", "run-1");
      expect(dispatchCallsOfType(refs, "SET_SEAT_STATUS")).toHaveLength(0);
      expect(refs.stoppedRunIds.has("run-1")).toBe(false);
    });
  });

  // ── Tool events ──────────────────────────────────────

  describe("agent tool events", () => {
    it("emits task-bubble and dispatches APPEND_CHAT for tool use", () => {
      const refs = createRefs();
      const client = createMockClient();
      wireGatewayClient(client as never, refs);

      client._emit("agent", {
        runId: "run-1",
        stream: "tool",
        data: {
          name: "Read",
          input: { path: "/foo" },
          output: "file contents",
        },
      });

      expect(gameEvents.emit).toHaveBeenCalledWith("task-bubble", "run-1", "🔧 Read", 3000);

      const chats = dispatchCallsOfType(refs, "APPEND_CHAT");
      expect(chats).toHaveLength(1);
      expect(chats[0].message.role).toBe("tool");
      expect(chats[0].message.toolName).toBe("Read");
      expect(chats[0].message.toolInput).toContain("/foo");
      expect(chats[0].message.toolOutput).toBe("file contents");
    });

    it("uses data.tool when data.name is absent", () => {
      const refs = createRefs();
      const client = createMockClient();
      wireGatewayClient(client as never, refs);

      client._emit("agent", {
        runId: "run-1",
        stream: "tool",
        data: { tool: "Bash" },
      });

      const chats = dispatchCallsOfType(refs, "APPEND_CHAT");
      expect(chats[0].message.toolName).toBe("Bash");
    });

    it("ignores tool events from stopped runs", () => {
      const refs = createRefs();
      refs.stoppedRunIds.add("run-1");
      const client = createMockClient();
      wireGatewayClient(client as never, refs);

      client._emit("agent", {
        runId: "run-1",
        stream: "tool",
        data: { name: "Read" },
      });

      expect(gameEvents.emit).not.toHaveBeenCalled();
      expect(dispatchCallsOfType(refs, "APPEND_CHAT")).toHaveLength(0);
    });

    it("skips tool event when neither name nor tool is provided", () => {
      const refs = createRefs();
      const client = createMockClient();
      wireGatewayClient(client as never, refs);

      client._emit("agent", {
        runId: "run-1",
        stream: "tool",
        data: { input: "stuff" },
      });

      expect(gameEvents.emit).not.toHaveBeenCalled();
      expect(dispatchCallsOfType(refs, "APPEND_CHAT")).toHaveLength(0);
    });

    it("formats non-string input/output as JSON", () => {
      const refs = createRefs();
      const client = createMockClient();
      wireGatewayClient(client as never, refs);

      client._emit("agent", {
        runId: "run-1",
        stream: "tool",
        data: {
          name: "Write",
          input: { path: "/a", content: "b" },
          output: { ok: true },
        },
      });

      const chats = dispatchCallsOfType(refs, "APPEND_CHAT");
      const msg = chats[0].message;
      expect(JSON.parse(msg.toolInput)).toEqual({ path: "/a", content: "b" });
      expect(JSON.parse(msg.toolOutput)).toEqual({ ok: true });
    });
  });

  // ── Assistant delta events ───────────────────────────

  describe("agent assistant delta events", () => {
    it("accumulates bubble text and dispatches APPEND_DELTA", () => {
      const refs = createRefs();
      const client = createMockClient();
      wireGatewayClient(client as never, refs);

      client._emit("agent", {
        runId: "run-1",
        stream: "assistant",
        data: { delta: "Hello " },
      });
      client._emit("agent", {
        runId: "run-1",
        stream: "assistant",
        data: { delta: "world" },
      });

      expect(refs.bubbleAccum.get("run-1")).toBe("Hello world");

      const deltas = dispatchCallsOfType(refs, "APPEND_DELTA");
      expect(deltas).toHaveLength(2);
      expect(deltas[0].delta).toBe("Hello ");
      expect(deltas[1].delta).toBe("world");
    });

    it("ignores empty delta strings", () => {
      const refs = createRefs();
      const client = createMockClient();
      wireGatewayClient(client as never, refs);

      client._emit("agent", {
        runId: "run-1",
        stream: "assistant",
        data: { delta: "" },
      });

      expect(refs.bubbleAccum.has("run-1")).toBe(false);
      expect(dispatchCallsOfType(refs, "APPEND_DELTA")).toHaveLength(0);
    });

    it("ignores deltas from stopped runs", () => {
      const refs = createRefs();
      refs.stoppedRunIds.add("run-1");
      const client = createMockClient();
      wireGatewayClient(client as never, refs);

      client._emit("agent", {
        runId: "run-1",
        stream: "assistant",
        data: { delta: "ignored" },
      });

      expect(refs.bubbleAccum.has("run-1")).toBe(false);
      expect(dispatchCallsOfType(refs, "APPEND_DELTA")).toHaveLength(0);
    });

    it("truncates accumulated bubble text at MAX_BUBBLE_ACCUM boundary", () => {
      const refs = createRefs();
      const client = createMockClient();
      wireGatewayClient(client as never, refs);

      // Seed with a huge string near the limit
      const bigText = "x".repeat(50_000);
      refs.bubbleAccum.set("run-1", bigText);

      client._emit("agent", {
        runId: "run-1",
        stream: "assistant",
        data: { delta: "extra" },
      });

      // Should be sliced to MAX_BUBBLE_ACCUM (50_000) from the end
      const accum = refs.bubbleAccum.get("run-1")!;
      expect(accum.length).toBe(50_000);
      expect(accum.endsWith("extra")).toBe(true);
    });

    it("includes actorName from runActors in APPEND_DELTA", () => {
      const refs = createRefs();
      refs.runActors.set("run-1", "Agent Alpha");
      const client = createMockClient();
      wireGatewayClient(client as never, refs);

      client._emit("agent", {
        runId: "run-1",
        stream: "assistant",
        data: { delta: "hi" },
      });

      const deltas = dispatchCallsOfType(refs, "APPEND_DELTA");
      expect(deltas[0].actorName).toBe("Agent Alpha");
    });
  });

  // ── Bubble throttling ────────────────────────────────

  describe("bubble throttling", () => {
    it("throttles bubble emits by BUBBLE_THROTTLE_MS (150ms)", () => {
      const refs = createRefs();
      const client = createMockClient();
      wireGatewayClient(client as never, refs);

      client._emit("agent", {
        runId: "run-1",
        stream: "assistant",
        data: { delta: "hi" },
      });

      // Not yet emitted
      expect(gameEvents.emit).not.toHaveBeenCalledWith(
        "task-bubble",
        "run-1",
        expect.any(String),
        expect.any(Number),
      );

      vi.advanceTimersByTime(150);

      expect(gameEvents.emit).toHaveBeenCalledWith("task-bubble", "run-1", "hi", 4000);
    });

    it("resets throttle timer on subsequent deltas within window", () => {
      const refs = createRefs();
      const client = createMockClient();
      wireGatewayClient(client as never, refs);

      client._emit("agent", {
        runId: "run-1",
        stream: "assistant",
        data: { delta: "A" },
      });

      vi.advanceTimersByTime(100); // <150ms

      client._emit("agent", {
        runId: "run-1",
        stream: "assistant",
        data: { delta: "B" },
      });

      vi.advanceTimersByTime(100); // 100ms after second delta — still <150
      expect(gameEvents.emit).not.toHaveBeenCalledWith(
        "task-bubble",
        "run-1",
        expect.any(String),
        expect.any(Number),
      );

      vi.advanceTimersByTime(50); // now 150ms after second delta
      expect(gameEvents.emit).toHaveBeenCalledWith("task-bubble", "run-1", "AB", 4000);
    });

    it("clears bubble timer on lifecycle end", () => {
      const refs = createRefs();
      const client = createMockClient();
      wireGatewayClient(client as never, refs);

      // Start a throttled bubble
      client._emit("agent", {
        runId: "run-1",
        stream: "assistant",
        data: { delta: "typing..." },
      });
      expect(refs.bubbleThrottleTimers.has("run-1")).toBe(true);

      // End lifecycle
      client._emit("agent", {
        runId: "run-1",
        stream: "lifecycle",
        data: { phase: "end" },
      });

      expect(refs.bubbleThrottleTimers.has("run-1")).toBe(false);

      // Advancing timer should NOT emit the old bubble
      vi.advanceTimersByTime(200);
      expect(gameEvents.emit).not.toHaveBeenCalledWith("task-bubble", "run-1", "typing...", 4000);
    });
  });

  // ── Session key resolution ───────────────────────────

  describe("session key resolution", () => {
    it("uses provided sessionKey when not a subagent", () => {
      const refs = createRefs();
      const client = createMockClient();
      wireGatewayClient(client as never, refs);

      client._emit("agent", {
        runId: "run-1",
        sessionKey: "agent:main:custom",
        stream: "lifecycle",
        data: { phase: "error", error: "test" },
      });

      const chats = dispatchCallsOfType(refs, "APPEND_CHAT");
      expect(chats[0].message.sessionKey).toBe("agent:main:custom");
    });

    it("falls back to task sessionKey from findTask", () => {
      (findTask as ReturnType<typeof vi.fn>).mockReturnValue({
        sessionKey: "agent:main:from-task",
      });

      const refs = createRefs();
      const client = createMockClient();
      wireGatewayClient(client as never, refs);

      client._emit("agent", {
        runId: "run-1",
        stream: "lifecycle",
        data: { phase: "error", error: "x" },
      });

      const chats = dispatchCallsOfType(refs, "APPEND_CHAT");
      expect(chats[0].message.sessionKey).toBe("agent:main:from-task");
    });

    it("falls back to activeSessionKey when no task match", () => {
      const refs = createRefs({ activeSessionKey: () => "agent:main:active" });
      const client = createMockClient();
      wireGatewayClient(client as never, refs);

      client._emit("agent", {
        runId: "run-1",
        stream: "lifecycle",
        data: { phase: "error", error: "x" },
      });

      const chats = dispatchCallsOfType(refs, "APPEND_CHAT");
      expect(chats[0].message.sessionKey).toBe("agent:main:active");
    });

    it("falls back to MAIN_SESSION_KEY as last resort", () => {
      const refs = createRefs();
      const client = createMockClient();
      wireGatewayClient(client as never, refs);

      client._emit("agent", {
        runId: "run-1",
        stream: "lifecycle",
        data: { phase: "error", error: "x" },
      });

      const chats = dispatchCallsOfType(refs, "APPEND_CHAT");
      expect(chats[0].message.sessionKey).toBe(MAIN_SESSION_KEY);
    });

    it("sets activeSessionKey when non-subagent has sessionKey and no active session", () => {
      const refs = createRefs();
      const client = createMockClient();
      wireGatewayClient(client as never, refs);

      client._emit("agent", {
        runId: "run-1",
        sessionKey: "agent:main:new-session",
        stream: "lifecycle",
        data: { phase: "start" },
      });

      expect(refs.setActiveSessionKey).toHaveBeenCalledWith("agent:main:new-session");
    });

    it("does NOT set activeSessionKey for subagent sessions", () => {
      const refs = createRefs();
      const client = createMockClient();
      wireGatewayClient(client as never, refs);

      client._emit("agent", {
        runId: "run-1",
        sessionKey: "subagent:xyz:123",
        stream: "lifecycle",
        data: { phase: "start", label: "sub" },
      });

      expect(refs.setActiveSessionKey).not.toHaveBeenCalled();
    });
  });

  // ── Subagent key regex ───────────────────────────────

  describe("subagent detection (SUBAGENT_KEY_RE)", () => {
    it("detects subagent: prefix in sessionKey", () => {
      const refs = createRefs();
      const client = createMockClient();
      wireGatewayClient(client as never, refs);

      client._emit("agent", {
        runId: "sub-1",
        sessionKey: "subagent:parent:child",
        stream: "lifecycle",
        data: { phase: "start", label: "analyzer" },
      });

      // Should be treated as subagent
      expect(gameEvents.emit).toHaveBeenCalledWith(
        "subagent-assigned",
        "sub-1",
        "sub-1",
        "analyzer",
        undefined,
      );
    });

    it("does not treat regular sessions as subagents", () => {
      const refs = createRefs();
      const client = createMockClient();
      wireGatewayClient(client as never, refs);

      client._emit("agent", {
        runId: "run-1",
        sessionKey: "agent:main:session1",
        stream: "lifecycle",
        data: { phase: "start" },
      });

      expect(gameEvents.emit).not.toHaveBeenCalledWith(
        "subagent-assigned",
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });
  });

  // ── Chat events ──────────────────────────────────────

  describe("chat events", () => {
    describe("state=final", () => {
      it("dispatches seat done + task completed + FINALIZE_ASSISTANT with text", () => {
        const refs = createRefs();
        const client = createMockClient();
        wireGatewayClient(client as never, refs);

        client._emit("chat", {
          runId: "run-1",
          state: "final",
          message: {
            content: [{ type: "text", text: "The answer is 42." }],
          },
        });

        const seatStatuses = dispatchCallsOfType(refs, "SET_SEAT_STATUS");
        expect(seatStatuses[0]).toEqual({
          type: "SET_SEAT_STATUS",
          runId: "run-1",
          status: "done",
        });

        const updates = dispatchCallsOfType(refs, "UPDATE_TASK");
        expect(updates[0].patch.status).toBe("completed");
        expect(updates[0].patch.result).toBe("The answer is 42.");

        const finalizes = dispatchCallsOfType(refs, "FINALIZE_ASSISTANT");
        expect(finalizes).toHaveLength(1);
        expect(finalizes[0].content).toBe("The answer is 42.");
      });

      it("skips FINALIZE_ASSISTANT when no text content", () => {
        const refs = createRefs();
        const client = createMockClient();
        wireGatewayClient(client as never, refs);

        client._emit("chat", {
          runId: "run-1",
          state: "final",
          message: {
            content: [{ type: "image", text: undefined }],
          },
        });

        expect(dispatchCallsOfType(refs, "FINALIZE_ASSISTANT")).toHaveLength(0);
        // But still dispatches seat/task updates
        expect(dispatchCallsOfType(refs, "SET_SEAT_STATUS")).toHaveLength(1);
      });

      it("ignores final for stopped runs but still refreshes", () => {
        const refs = createRefs();
        refs.stoppedRunIds.add("run-1");
        const client = createMockClient();
        wireGatewayClient(client as never, refs);

        client._emit("chat", {
          runId: "run-1",
          state: "final",
          message: { content: [{ type: "text", text: "done" }] },
        });

        expect(dispatchCallsOfType(refs, "SET_SEAT_STATUS")).toHaveLength(0);
        expect(dispatchCallsOfType(refs, "FINALIZE_ASSISTANT")).toHaveLength(0);
      });

      it("includes actorName from runActors in FINALIZE_ASSISTANT", () => {
        const refs = createRefs();
        refs.runActors.set("run-1", "Coder");
        const client = createMockClient();
        wireGatewayClient(client as never, refs);

        client._emit("chat", {
          runId: "run-1",
          state: "final",
          message: { content: [{ type: "text", text: "result" }] },
        });

        const finalizes = dispatchCallsOfType(refs, "FINALIZE_ASSISTANT");
        expect(finalizes[0].actorName).toBe("Coder");
      });
    });

    describe("state=error", () => {
      it("dispatches failed status and emits task-failed", () => {
        const refs = createRefs();
        const client = createMockClient();
        wireGatewayClient(client as never, refs);

        client._emit("chat", {
          runId: "run-1",
          state: "error",
        });

        expect(gameEvents.emit).toHaveBeenCalledWith("task-failed", "run-1");

        const updates = dispatchCallsOfType(refs, "UPDATE_TASK");
        expect(updates[0].patch.status).toBe("failed");

        const seatStatuses = dispatchCallsOfType(refs, "SET_SEAT_STATUS");
        expect(seatStatuses[0].status).toBe("failed");

        const chats = dispatchCallsOfType(refs, "APPEND_CHAT");
        expect(chats[0].message.content).toBe("Task failed");
      });
    });

    describe("state=aborted", () => {
      it("dispatches stopped status and emits task-aborted", () => {
        const refs = createRefs();
        const client = createMockClient();
        wireGatewayClient(client as never, refs);

        client._emit("chat", {
          runId: "run-1",
          state: "aborted",
        });

        expect(gameEvents.emit).toHaveBeenCalledWith("task-aborted", "run-1");

        const updates = dispatchCallsOfType(refs, "UPDATE_TASK");
        expect(updates[0].patch.status).toBe("stopped");

        const seatStatuses = dispatchCallsOfType(refs, "SET_SEAT_STATUS");
        expect(seatStatuses[0].status).toBe("empty");

        const chats = dispatchCallsOfType(refs, "APPEND_CHAT");
        expect(chats[0].message.content).toBe("Task stopped");
      });

      it("skips APPEND_CHAT when run was already stopped", () => {
        const refs = createRefs();
        refs.stoppedRunIds.add("run-1");
        const client = createMockClient();
        wireGatewayClient(client as never, refs);

        client._emit("chat", {
          runId: "run-1",
          state: "aborted",
        });

        // Still dispatches UPDATE_TASK and SET_SEAT_STATUS
        expect(dispatchCallsOfType(refs, "UPDATE_TASK")).toHaveLength(1);
        expect(dispatchCallsOfType(refs, "SET_SEAT_STATUS")).toHaveLength(1);
        // But no chat message
        expect(dispatchCallsOfType(refs, "APPEND_CHAT")).toHaveLength(0);
      });
    });

    it("sets activeSessionKey from chat event when not subagent and no active session", () => {
      const refs = createRefs();
      const client = createMockClient();
      wireGatewayClient(client as never, refs);

      client._emit("chat", {
        runId: "run-1",
        sessionKey: "agent:main:chat-session",
        state: "final",
        message: { content: [] },
      });

      expect(refs.setActiveSessionKey).toHaveBeenCalledWith("agent:main:chat-session");
    });

    it("ignores chat events with no runId", () => {
      const refs = createRefs();
      const client = createMockClient();
      wireGatewayClient(client as never, refs);

      client._emit("chat", { state: "final", message: { content: [] } });

      expect(getDispatch(refs)).not.toHaveBeenCalled();
    });
  });

  // ── Final response handler ───────────────────────────

  describe("onFinalResponse", () => {
    it("marks task completed when ok=true and status=ok", () => {
      const refs = createRefs();
      const client = createMockClient();
      wireGatewayClient(client as never, refs);

      client._emitFinal({
        ok: true,
        payload: { runId: "run-1", status: "ok" },
      });

      const seatStatuses = dispatchCallsOfType(refs, "SET_SEAT_STATUS");
      expect(seatStatuses[0].status).toBe("done");

      const updates = dispatchCallsOfType(refs, "UPDATE_TASK");
      expect(updates[0].patch.status).toBe("completed");
    });

    it("marks task completed when status=completed", () => {
      const refs = createRefs();
      const client = createMockClient();
      wireGatewayClient(client as never, refs);

      client._emitFinal({
        ok: true,
        payload: { runId: "run-1", status: "completed" },
      });

      const updates = dispatchCallsOfType(refs, "UPDATE_TASK");
      expect(updates[0].patch.status).toBe("completed");
    });

    it("marks task failed when ok=false", () => {
      const refs = createRefs();
      const client = createMockClient();
      wireGatewayClient(client as never, refs);

      client._emitFinal({
        ok: false,
        payload: { runId: "run-1", status: "error" },
      });

      const updates = dispatchCallsOfType(refs, "UPDATE_TASK");
      expect(updates[0].patch.status).toBe("failed");

      const seatStatuses = dispatchCallsOfType(refs, "SET_SEAT_STATUS");
      expect(seatStatuses[0].status).toBe("failed");
    });

    it("marks task failed on timeout status", () => {
      const refs = createRefs();
      const client = createMockClient();
      wireGatewayClient(client as never, refs);

      client._emitFinal({
        ok: true,
        payload: { runId: "run-1", status: "timeout" },
      });

      const updates = dispatchCallsOfType(refs, "UPDATE_TASK");
      expect(updates[0].patch.status).toBe("failed");
    });

    it("ignores final response for stopped runs", () => {
      const refs = createRefs();
      refs.stoppedRunIds.add("run-1");
      const client = createMockClient();
      wireGatewayClient(client as never, refs);

      client._emitFinal({
        ok: true,
        payload: { runId: "run-1", status: "ok" },
      });

      expect(getDispatch(refs)).not.toHaveBeenCalled();
    });

    it("ignores final response with no runId", () => {
      const refs = createRefs();
      const client = createMockClient();
      wireGatewayClient(client as never, refs);

      client._emitFinal({ ok: true, payload: {} });

      expect(getDispatch(refs)).not.toHaveBeenCalled();
    });
  });

  // ── stoppedRunIds cleanup ────────────────────────────

  describe("stoppedRunIds cleanup", () => {
    it("removes runId from stoppedRunIds on lifecycle end", () => {
      const refs = createRefs();
      refs.stoppedRunIds.add("run-1");
      refs.stoppedRunIds.add("run-2");
      const client = createMockClient();
      wireGatewayClient(client as never, refs);

      client._emit("agent", {
        runId: "run-1",
        stream: "lifecycle",
        data: { phase: "end" },
      });

      expect(refs.stoppedRunIds.has("run-1")).toBe(false);
      expect(refs.stoppedRunIds.has("run-2")).toBe(true); // untouched
    });

    it("removes runId from stoppedRunIds on lifecycle error", () => {
      const refs = createRefs();
      refs.stoppedRunIds.add("run-1");
      const client = createMockClient();
      wireGatewayClient(client as never, refs);

      client._emit("agent", {
        runId: "run-1",
        stream: "lifecycle",
        data: { phase: "error", error: "boom" },
      });

      expect(refs.stoppedRunIds.has("run-1")).toBe(false);
    });
  });
});

// ── loadSessionPreview ─────────────────────────────────

describe("loadSessionPreview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array when client is not connected", async () => {
    const client = createMockClient();
    client.status = "disconnected";

    const result = await loadSessionPreview(client as never, "key");
    expect(result).toEqual([]);
  });

  it("returns empty array when no matching preview entry", async () => {
    const client = createMockClient();
    client.request.mockResolvedValue({
      payload: { previews: [{ key: "other-key", status: "ok", items: [] }] },
    });

    const result = await loadSessionPreview(client as never, "my-key");
    expect(result).toEqual([]);
  });

  it("returns empty array when entry status is not ok", async () => {
    const client = createMockClient();
    client.request.mockResolvedValue({
      payload: {
        previews: [{ key: "my-key", status: "missing", items: [] }],
      },
    });

    const result = await loadSessionPreview(client as never, "my-key");
    expect(result).toEqual([]);
  });

  it("returns empty array when items list is empty", async () => {
    const client = createMockClient();
    client.request.mockResolvedValue({
      payload: {
        previews: [{ key: "my-key", status: "ok", items: [] }],
      },
    });

    const result = await loadSessionPreview(client as never, "my-key");
    expect(result).toEqual([]);
  });

  it("maps user/assistant items to ChatMessages", async () => {
    const client = createMockClient();
    client.request.mockResolvedValue({
      payload: {
        previews: [
          {
            key: "sess-1",
            status: "ok",
            items: [
              { role: "user", text: "Hello" },
              { role: "assistant", text: "Hi there" },
            ],
          },
        ],
      },
    });

    const result = await loadSessionPreview(client as never, "sess-1");
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe("user");
    expect(result[0].content).toBe("Hello");
    expect(result[0].sessionKey).toBe("sess-1");
    expect(result[1].role).toBe("assistant");
    expect(result[1].content).toBe("Hi there");
  });

  it("maps 'other' role to 'system'", async () => {
    const client = createMockClient();
    client.request.mockResolvedValue({
      payload: {
        previews: [
          {
            key: "sess-1",
            status: "ok",
            items: [{ role: "other", text: "System note" }],
          },
        ],
      },
    });

    const result = await loadSessionPreview(client as never, "sess-1");
    expect(result[0].role).toBe("system");
    expect(result[0].content).toBe("System note");
  });

  it("aggregates consecutive tool items into toolOutput", async () => {
    const client = createMockClient();
    client.request.mockResolvedValue({
      payload: {
        previews: [
          {
            key: "sess-1",
            status: "ok",
            items: [
              { role: "tool", text: "Read" },
              { role: "tool", text: "file contents line 1" },
              { role: "tool", text: "file contents line 2" },
              { role: "user", text: "Thanks" },
            ],
          },
        ],
      },
    });

    const result = await loadSessionPreview(client as never, "sess-1");
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe("tool");
    const toolMsg0 = result[0] as import("@/types/game").ToolChatMessage;
    expect(toolMsg0.toolName).toBe("Read");
    expect(toolMsg0.toolOutput).toBe("file contents line 1\n\n---\n\nfile contents line 2");
    expect(result[1].role).toBe("user");
  });

  it("handles tool item with no following tool items (no toolOutput)", async () => {
    const client = createMockClient();
    client.request.mockResolvedValue({
      payload: {
        previews: [
          {
            key: "sess-1",
            status: "ok",
            items: [
              { role: "tool", text: "Bash" },
              { role: "user", text: "ok" },
            ],
          },
        ],
      },
    });

    const result = await loadSessionPreview(client as never, "sess-1");
    expect(result[0].role).toBe("tool");
    const toolMsg = result[0] as import("@/types/game").ToolChatMessage;
    expect(toolMsg.toolOutput).toBeUndefined();
  });

  it("returns empty array on request failure", async () => {
    const client = createMockClient();
    client.request.mockRejectedValue(new Error("network error"));

    const result = await loadSessionPreview(client as never, "sess-1");
    expect(result).toEqual([]);
  });

  it("passes correct params to client.request", async () => {
    const client = createMockClient();
    client.request.mockResolvedValue({ payload: { previews: [] } });

    await loadSessionPreview(client as never, "my-session");

    expect(client.request).toHaveBeenCalledWith("sessions.preview", {
      keys: ["my-session"],
      limit: 50,
      maxChars: 2000,
    });
  });
});
