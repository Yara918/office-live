import { describe, it, expect, beforeEach } from "vitest";
import {
  reducer,
  initialState,
  chatId,
  generateSessionKey,
  findTask,
  findAssignableSeatIndex,
  resolveSeatLabelForTask,
  createEmptySessionMetrics,
  mergeDiscoveredSeats,
  MAIN_SESSION_KEY,
} from "../reducer";
import type { Action } from "../reducer";
import type {
  StudioSnapshot,
  TaskItem,
  ChatMessage,
  SeatState,
  SessionRecord,
  SessionMetrics,
} from "@/types/game";
import type { SeatDef } from "@/components/game/utils/MapHelpers";
import type { PersistedSeatConfig } from "@/lib/persistence";

// ── Factory helpers ─────────────────────────────────────────

function makeSeat(overrides: Partial<SeatState> = {}): SeatState {
  return {
    seatId: "seat-1",
    label: "Alice",
    seatType: "worker",
    assigned: true,
    status: "empty",
    spawnX: 100,
    spawnY: 200,
    spawnFacing: "down",
    ...overrides,
  };
}

function makeTask(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    taskId: "task-1",
    message: "Do something",
    status: "submitted",
    sessionKey: MAIN_SESSION_KEY,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeChat(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "chat-1",
    runId: "run-1",
    role: "user",
    content: "Hello",
    timestamp: new Date().toISOString(),
    sessionKey: MAIN_SESSION_KEY,
    ...overrides,
  } as ChatMessage;
}

function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    key: "agent:main:session-1",
    label: "Session 1",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeState(overrides: Partial<StudioSnapshot> = {}): StudioSnapshot {
  return { ...initialState, ...overrides };
}

function makeDiscoveredSeat(overrides: Partial<SeatDef> = {}): SeatDef {
  return {
    seatId: "seat-1",
    x: 100,
    y: 200,
    facing: "down",
    index: 0,
    ...overrides,
  };
}

function makePersistedConfig(overrides: Partial<PersistedSeatConfig> = {}): PersistedSeatConfig {
  return {
    seatId: "seat-1",
    label: "Custom Label",
    seatType: "worker",
    assigned: true,
    spriteKey: "char_01",
    spritePath: "/chars/01.png",
    ...overrides,
  };
}

// ── Helper function tests ───────────────────────────────────

describe("MAIN_SESSION_KEY", () => {
  it("has the expected value", () => {
    expect(MAIN_SESSION_KEY).toBe("agent:main:main");
  });
});

describe("chatId", () => {
  it("returns a string starting with chat_", () => {
    const id = chatId();
    expect(id).toMatch(/^chat_\d+_\d+$/);
  });

  it("returns unique ids on successive calls", () => {
    const a = chatId();
    const b = chatId();
    expect(a).not.toBe(b);
  });
});

describe("generateSessionKey", () => {
  it("returns a string starting with agent:main:", () => {
    const key = generateSessionKey();
    expect(key).toMatch(/^agent:main:\d+_\d+$/);
  });

  it("returns unique keys on successive calls", () => {
    const a = generateSessionKey();
    const b = generateSessionKey();
    expect(a).not.toBe(b);
  });
});

describe("findTask", () => {
  const tasks = [makeTask({ taskId: "t1", runId: "r1" }), makeTask({ taskId: "t2", runId: "r2" })];

  it("finds a task by taskId", () => {
    expect(findTask(tasks, "t1")).toBe(tasks[0]);
  });

  it("finds a task by runId", () => {
    expect(findTask(tasks, "r2")).toBe(tasks[1]);
  });

  it("returns undefined when no match", () => {
    expect(findTask(tasks, "nonexistent")).toBeUndefined();
  });

  it("returns undefined for empty array", () => {
    expect(findTask([], "t1")).toBeUndefined();
  });
});

describe("findAssignableSeatIndex", () => {
  it("returns index of first assigned seat not running or returning", () => {
    const seats = [
      makeSeat({ seatId: "s1", assigned: true, status: "running" }),
      makeSeat({ seatId: "s2", assigned: true, status: "empty" }),
      makeSeat({ seatId: "s3", assigned: true, status: "empty" }),
    ];
    expect(findAssignableSeatIndex(seats)).toBe(1);
  });

  it("returns -1 when no assignable seat exists", () => {
    const seats = [
      makeSeat({ seatId: "s1", assigned: true, status: "running" }),
      makeSeat({ seatId: "s2", assigned: false, status: "empty" }),
    ];
    expect(findAssignableSeatIndex(seats)).toBe(-1);
  });

  it("returns -1 for empty array", () => {
    expect(findAssignableSeatIndex([])).toBe(-1);
  });

  it("skips returning seats", () => {
    const seats = [
      makeSeat({ seatId: "s1", assigned: true, status: "returning" }),
      makeSeat({ seatId: "s2", assigned: true, status: "done" }),
    ];
    expect(findAssignableSeatIndex(seats)).toBe(1);
  });
});

describe("resolveSeatLabelForTask", () => {
  const seats = [
    makeSeat({ seatId: "s1", label: "Alice", assigned: true, status: "running" }),
    makeSeat({ seatId: "s2", label: "Bob", assigned: true, status: "empty" }),
  ];

  it("returns label for a specific seatId", () => {
    expect(resolveSeatLabelForTask(seats, "s1")).toBe("Alice");
  });

  it("returns label for first assignable seat when no seatId given", () => {
    expect(resolveSeatLabelForTask(seats)).toBe("Bob");
  });

  it("returns undefined when seatId does not exist", () => {
    expect(resolveSeatLabelForTask(seats, "nonexistent")).toBeUndefined();
  });

  it("returns undefined when no assignable seat and no seatId", () => {
    const allRunning = [makeSeat({ seatId: "s1", assigned: true, status: "running" })];
    expect(resolveSeatLabelForTask(allRunning)).toBeUndefined();
  });
});

describe("createEmptySessionMetrics", () => {
  it("returns an object with fresh: false", () => {
    const metrics = createEmptySessionMetrics();
    expect(metrics).toEqual({ fresh: false });
  });

  it("returns a new object each time", () => {
    const a = createEmptySessionMetrics();
    const b = createEmptySessionMetrics();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe("mergeDiscoveredSeats", () => {
  it("creates seats from discovered definitions with defaults", () => {
    const discovered = [makeDiscoveredSeat({ seatId: "s1", index: 0 })];
    const result = mergeDiscoveredSeats(discovered, [], []);
    expect(result).toHaveLength(1);
    expect(result[0].seatId).toBe("s1");
    expect(result[0].spawnX).toBe(100);
    expect(result[0].spawnY).toBe(200);
    expect(result[0].spawnFacing).toBe("down");
    expect(result[0].status).toBe("empty");
  });

  it("applies stored config overrides", () => {
    const discovered = [makeDiscoveredSeat({ seatId: "s1", index: 0 })];
    const stored = [
      makePersistedConfig({
        seatId: "s1",
        label: "My Custom Seat",
        seatType: "agent",
        roleTitle: "Architect",
        assigned: true,
      }),
    ];
    const result = mergeDiscoveredSeats(discovered, stored, []);
    expect(result[0].label).toBe("My Custom Seat");
    expect(result[0].seatType).toBe("agent");
    expect(result[0].roleTitle).toBe("Architect");
  });

  it("preserves runtime state from current seats", () => {
    const discovered = [makeDiscoveredSeat({ seatId: "s1", index: 0 })];
    const current = [
      makeSeat({
        seatId: "s1",
        status: "running",
        runId: "run-42",
        taskSnippet: "doing work",
        startedAt: "2025-01-01T00:00:00Z",
      }),
    ];
    const result = mergeDiscoveredSeats(discovered, [], current);
    expect(result[0].status).toBe("running");
    expect(result[0].runId).toBe("run-42");
    expect(result[0].taskSnippet).toBe("doing work");
    expect(result[0].startedAt).toBe("2025-01-01T00:00:00Z");
  });

  it("unassigned seats have no spriteKey/spritePath", () => {
    const discovered = [makeDiscoveredSeat({ seatId: "s1", index: 0 })];
    const stored = [makePersistedConfig({ seatId: "s1", assigned: false })];
    const result = mergeDiscoveredSeats(discovered, stored, []);
    expect(result[0].assigned).toBe(false);
    expect(result[0].spriteKey).toBeUndefined();
    expect(result[0].spritePath).toBeUndefined();
  });

  it("applies agentConfig from stored config", () => {
    const discovered = [makeDiscoveredSeat({ seatId: "s1", index: 0 })];
    const agentConfig = { agentId: "agent-x", model: "gpt-4" };
    const stored = [makePersistedConfig({ seatId: "s1", agentConfig })];
    const result = mergeDiscoveredSeats(discovered, stored, []);
    expect(result[0].agentConfig).toEqual(agentConfig);
  });
});

// ── Reducer action tests ────────────────────────────────────

describe("reducer", () => {
  let state: StudioSnapshot;

  beforeEach(() => {
    state = makeState();
  });

  describe("initialState", () => {
    it("has expected defaults", () => {
      expect(initialState.connection).toBe("disconnected");
      expect(initialState.seats).toHaveLength(7);
      expect(initialState.seats.every((seat) => seat.status === "empty")).toBe(true);
      expect(initialState.seats.every((seat) => seat.assigned === false)).toBe(true);
      expect(initialState.tasks).toEqual([]);
      expect(initialState.chatMessages).toEqual([]);
      expect(initialState.activeSessionKey).toBeUndefined();
      expect(initialState.sessionMetrics).toEqual({ fresh: false });
      expect(initialState.sessions).toEqual([]);
    });
  });

  describe("SET_CONNECTION", () => {
    it("updates connection status", () => {
      const next = reducer(state, { type: "SET_CONNECTION", status: "connected" });
      expect(next.connection).toBe("connected");
    });

    it("does not mutate other state", () => {
      const next = reducer(state, { type: "SET_CONNECTION", status: "error" });
      expect(next.tasks).toBe(state.tasks);
      expect(next.seats).toBe(state.seats);
    });
  });

  describe("ADD_TASK", () => {
    it("prepends a task to the list", () => {
      const task = makeTask({ taskId: "t1" });
      const next = reducer(state, { type: "ADD_TASK", task });
      expect(next.tasks).toHaveLength(1);
      expect(next.tasks[0]).toBe(task);
    });

    it("prepends new tasks before existing ones", () => {
      const t1 = makeTask({ taskId: "t1" });
      const t2 = makeTask({ taskId: "t2" });
      const s1 = reducer(state, { type: "ADD_TASK", task: t1 });
      const s2 = reducer(s1, { type: "ADD_TASK", task: t2 });
      expect(s2.tasks[0].taskId).toBe("t2");
      expect(s2.tasks[1].taskId).toBe("t1");
    });
  });

  describe("UPDATE_TASK", () => {
    it("patches a task by taskId", () => {
      state = makeState({ tasks: [makeTask({ taskId: "t1", status: "submitted" })] });
      const next = reducer(state, {
        type: "UPDATE_TASK",
        taskId: "t1",
        patch: { status: "running" },
      });
      expect(next.tasks[0].status).toBe("running");
    });

    it("patches a task by runId", () => {
      state = makeState({
        tasks: [makeTask({ taskId: "t1", runId: "r1", status: "submitted" })],
      });
      const next = reducer(state, {
        type: "UPDATE_TASK",
        taskId: "r1",
        patch: { status: "completed", result: "Done" },
      });
      expect(next.tasks[0].status).toBe("completed");
      expect(next.tasks[0].result).toBe("Done");
    });

    it("leaves unmatched tasks unchanged", () => {
      const t1 = makeTask({ taskId: "t1" });
      const t2 = makeTask({ taskId: "t2" });
      state = makeState({ tasks: [t1, t2] });
      const next = reducer(state, {
        type: "UPDATE_TASK",
        taskId: "t1",
        patch: { status: "running" },
      });
      expect(next.tasks[1]).toEqual(t2);
    });
  });

  describe("APPEND_CHAT", () => {
    it("appends a chat message", () => {
      const msg = makeChat({ id: "c1", content: "Hi" });
      const next = reducer(state, { type: "APPEND_CHAT", message: msg });
      expect(next.chatMessages).toHaveLength(1);
      expect(next.chatMessages[0]).toBe(msg);
    });

    it("skips redundant connection messages", () => {
      const msg = makeChat({
        id: "c1",
        role: "system",
        content: "Connected to ws://localhost",
      });
      const next = reducer(state, { type: "APPEND_CHAT", message: msg });
      expect(next.chatMessages).toHaveLength(0);
      expect(next).toBe(state);
    });

    it("does not skip non-connection system messages", () => {
      const msg = makeChat({
        id: "c1",
        role: "system",
        content: "Session started",
      });
      const next = reducer(state, { type: "APPEND_CHAT", message: msg });
      expect(next.chatMessages).toHaveLength(1);
    });
  });

  describe("APPEND_DELTA", () => {
    it("appends delta to existing assistant message with matching runId", () => {
      const existing = makeChat({
        id: "c1",
        runId: "run-1",
        role: "assistant",
        content: "Hello",
      });
      state = makeState({ chatMessages: [existing] });
      const next = reducer(state, {
        type: "APPEND_DELTA",
        runId: "run-1",
        delta: " world",
      });
      expect(next.chatMessages[0].content).toBe("Hello world");
      expect((next.chatMessages[0] as { streaming?: boolean }).streaming).toBe(true);
    });

    it("creates a new assistant message if none found", () => {
      state = makeState({
        tasks: [makeTask({ taskId: "t1", runId: "run-1" })],
      });
      const next = reducer(state, {
        type: "APPEND_DELTA",
        runId: "run-1",
        delta: "Hi",
      });
      expect(next.chatMessages).toHaveLength(1);
      expect(next.chatMessages[0].role).toBe("assistant");
      expect(next.chatMessages[0].content).toBe("Hi");
      expect((next.chatMessages[0] as { streaming?: boolean }).streaming).toBe(true);
    });

    it("sets actorName on existing message if not already set", () => {
      const existing = makeChat({
        id: "c1",
        runId: "run-1",
        role: "assistant",
        content: "Hello",
      });
      state = makeState({ chatMessages: [existing] });
      const next = reducer(state, {
        type: "APPEND_DELTA",
        runId: "run-1",
        delta: " there",
        actorName: "Alice",
      });
      expect(next.chatMessages[0].actorName).toBe("Alice");
    });

    it("does not overwrite existing actorName", () => {
      const existing = makeChat({
        id: "c1",
        runId: "run-1",
        role: "assistant",
        content: "Hi",
        actorName: "Bob",
      });
      state = makeState({ chatMessages: [existing] });
      const next = reducer(state, {
        type: "APPEND_DELTA",
        runId: "run-1",
        delta: "!",
        actorName: "Alice",
      });
      expect(next.chatMessages[0].actorName).toBe("Bob");
    });

    it("does not modify tool messages", () => {
      const toolMsg: ChatMessage = {
        id: "c1",
        runId: "run-1",
        role: "tool",
        content: "output",
        timestamp: new Date().toISOString(),
        sessionKey: MAIN_SESSION_KEY,
        toolName: "read_file",
      };
      // An assistant message before the tool message
      const assistantMsg = makeChat({
        id: "c0",
        runId: "run-1",
        role: "assistant",
        content: "Let me check",
      });
      state = makeState({ chatMessages: [assistantMsg, toolMsg] });
      const next = reducer(state, {
        type: "APPEND_DELTA",
        runId: "run-1",
        delta: " more",
      });
      // Should find the assistant message (last assistant by runId), not the tool
      // Tool message at index 1 is the last with runId, but it's role=tool
      // The search goes backwards: finds tool first (skipped due to role check), then finds assistant
      expect(next.chatMessages[1].content).toBe("output"); // tool unchanged
    });
  });

  describe("FINALIZE_ASSISTANT", () => {
    it("replaces content and sets streaming false", () => {
      const existing = makeChat({
        id: "c1",
        runId: "run-1",
        role: "assistant",
        content: "partial...",
        streaming: true,
      } as Partial<ChatMessage>);
      state = makeState({ chatMessages: [existing] });
      const next = reducer(state, {
        type: "FINALIZE_ASSISTANT",
        runId: "run-1",
        content: "Final content",
      });
      expect(next.chatMessages[0].content).toBe("Final content");
      expect((next.chatMessages[0] as { streaming?: boolean }).streaming).toBe(false);
    });

    it("creates a new message if no existing assistant found", () => {
      state = makeState({
        tasks: [makeTask({ taskId: "t1", runId: "run-1" })],
      });
      const next = reducer(state, {
        type: "FINALIZE_ASSISTANT",
        runId: "run-1",
        content: "Complete response",
      });
      expect(next.chatMessages).toHaveLength(1);
      expect(next.chatMessages[0].content).toBe("Complete response");
      expect((next.chatMessages[0] as { streaming?: boolean }).streaming).toBe(false);
    });

    it("sets actorName if not already present", () => {
      const existing = makeChat({
        id: "c1",
        runId: "run-1",
        role: "assistant",
        content: "partial",
      });
      state = makeState({ chatMessages: [existing] });
      const next = reducer(state, {
        type: "FINALIZE_ASSISTANT",
        runId: "run-1",
        content: "done",
        actorName: "Carol",
      });
      expect(next.chatMessages[0].actorName).toBe("Carol");
    });
  });

  describe("SET_RUN_ACTOR", () => {
    it("sets actorName on all assistant messages for a runId", () => {
      state = makeState({
        chatMessages: [
          makeChat({ id: "c1", runId: "run-1", role: "assistant", content: "Hi" }),
          makeChat({ id: "c2", runId: "run-1", role: "user", content: "Hey" }),
          makeChat({ id: "c3", runId: "run-2", role: "assistant", content: "Bye" }),
        ],
      });
      const next = reducer(state, {
        type: "SET_RUN_ACTOR",
        runId: "run-1",
        actorName: "Alice",
      });
      expect(next.chatMessages[0].actorName).toBe("Alice");
      expect(next.chatMessages[1].actorName).toBeUndefined(); // user message
      expect(next.chatMessages[2].actorName).toBeUndefined(); // different runId
    });
  });

  describe("SET_ACTIVE_SESSION", () => {
    it("sets the active session key", () => {
      const next = reducer(state, {
        type: "SET_ACTIVE_SESSION",
        sessionKey: "agent:main:session-1",
      });
      expect(next.activeSessionKey).toBe("agent:main:session-1");
    });

    it("can clear active session", () => {
      state = makeState({ activeSessionKey: "something" });
      const next = reducer(state, {
        type: "SET_ACTIVE_SESSION",
        sessionKey: undefined,
      });
      expect(next.activeSessionKey).toBeUndefined();
    });
  });

  describe("SET_SESSION_METRICS", () => {
    it("replaces session metrics", () => {
      const metrics: SessionMetrics = {
        fresh: true,
        usedTokens: 1000,
        maxContextTokens: 100000,
        model: "claude-opus-4",
      };
      const next = reducer(state, { type: "SET_SESSION_METRICS", metrics });
      expect(next.sessionMetrics).toBe(metrics);
    });
  });

  describe("ASSIGN_SEAT", () => {
    it("assigns a run to the first assignable seat", () => {
      state = makeState({
        seats: [
          makeSeat({ seatId: "s1", assigned: true, status: "running", runId: "other" }),
          makeSeat({ seatId: "s2", assigned: true, status: "empty" }),
        ],
      });
      const next = reducer(state, {
        type: "ASSIGN_SEAT",
        runId: "run-1",
        taskSnippet: "Do X",
      });
      expect(next.seats[1].status).toBe("running");
      expect(next.seats[1].runId).toBe("run-1");
      expect(next.seats[1].taskSnippet).toBe("Do X");
      expect(next.seats[1].startedAt).toBeDefined();
    });

    it("assigns to a specific seatId", () => {
      state = makeState({
        seats: [
          makeSeat({ seatId: "s1", assigned: true, status: "empty" }),
          makeSeat({ seatId: "s2", assigned: true, status: "empty" }),
        ],
      });
      const next = reducer(state, {
        type: "ASSIGN_SEAT",
        runId: "run-1",
        taskSnippet: "Do Y",
        seatId: "s2",
      });
      expect(next.seats[0].status).toBe("empty"); // s1 unchanged
      expect(next.seats[1].status).toBe("running");
      expect(next.seats[1].runId).toBe("run-1");
    });

    it("returns unchanged state if no assignable seat", () => {
      state = makeState({
        seats: [makeSeat({ seatId: "s1", assigned: true, status: "running", runId: "r0" })],
      });
      const next = reducer(state, {
        type: "ASSIGN_SEAT",
        runId: "run-1",
        taskSnippet: "Do Z",
      });
      expect(next).toBe(state);
    });

    it("does not reassign a seat already running with a different runId", () => {
      state = makeState({
        seats: [makeSeat({ seatId: "s1", assigned: true, status: "running", runId: "run-old" })],
      });
      const next = reducer(state, {
        type: "ASSIGN_SEAT",
        runId: "run-new",
        taskSnippet: "New task",
        seatId: "s1",
      });
      expect(next).toBe(state);
    });

    it("allows reassigning a seat with the same runId", () => {
      state = makeState({
        seats: [makeSeat({ seatId: "s1", assigned: true, status: "running", runId: "run-1" })],
      });
      const next = reducer(state, {
        type: "ASSIGN_SEAT",
        runId: "run-1",
        taskSnippet: "Same run",
        seatId: "s1",
      });
      expect(next.seats[0].runId).toBe("run-1");
      expect(next.seats[0].taskSnippet).toBe("Same run");
    });

    it("returns unchanged state when seatId not found", () => {
      state = makeState({ seats: [makeSeat({ seatId: "s1" })] });
      const next = reducer(state, {
        type: "ASSIGN_SEAT",
        runId: "run-1",
        taskSnippet: "X",
        seatId: "nonexistent",
      });
      expect(next).toBe(state);
    });
  });

  describe("BIND_SEAT_RUN", () => {
    it("updates runId on the seat that had the old taskId as runId", () => {
      state = makeState({
        seats: [
          makeSeat({ seatId: "s1", runId: "task-1", status: "running" }),
          makeSeat({ seatId: "s2", runId: "other", status: "running" }),
        ],
      });
      const next = reducer(state, {
        type: "BIND_SEAT_RUN",
        taskId: "task-1",
        runId: "run-1",
      });
      expect(next.seats[0].runId).toBe("run-1");
      expect(next.seats[1].runId).toBe("other");
    });
  });

  describe("SET_SEAT_STATUS", () => {
    it("updates status of seats matching runId", () => {
      state = makeState({
        seats: [
          makeSeat({ seatId: "s1", runId: "run-1", status: "running" }),
          makeSeat({ seatId: "s2", runId: "run-2", status: "running" }),
        ],
      });
      const next = reducer(state, {
        type: "SET_SEAT_STATUS",
        runId: "run-1",
        status: "done",
      });
      expect(next.seats[0].status).toBe("done");
      expect(next.seats[1].status).toBe("running");
    });

    it("clears runtime fields when setting status to empty", () => {
      state = makeState({
        seats: [
          makeSeat({
            seatId: "s1",
            runId: "run-1",
            status: "running",
            taskSnippet: "working",
            startedAt: "2025-01-01T00:00:00Z",
          }),
        ],
      });
      const next = reducer(state, {
        type: "SET_SEAT_STATUS",
        runId: "run-1",
        status: "empty",
      });
      expect(next.seats[0].status).toBe("empty");
      expect(next.seats[0].runId).toBeUndefined();
      expect(next.seats[0].taskSnippet).toBeUndefined();
      expect(next.seats[0].startedAt).toBeUndefined();
    });
  });

  describe("PATCH_SEAT_RUNTIME", () => {
    it("patches runtime fields on the seat matching seatId", () => {
      state = makeState({
        seats: [
          makeSeat({ seatId: "s1", status: "empty" }),
          makeSeat({ seatId: "s2", status: "empty" }),
        ],
      });
      const next = reducer(state, {
        type: "PATCH_SEAT_RUNTIME",
        seatId: "s1",
        patch: { status: "running", runId: "run-1" },
      });
      expect(next.seats[0].status).toBe("running");
      expect(next.seats[0].runId).toBe("run-1");
      expect(next.seats[1].status).toBe("empty");
    });
  });

  describe("SYNC_SEATS", () => {
    it("replaces all seats", () => {
      const newSeats = [makeSeat({ seatId: "new-1" }), makeSeat({ seatId: "new-2" })];
      const next = reducer(state, { type: "SYNC_SEATS", seats: newSeats });
      expect(next.seats).toBe(newSeats);
    });
  });

  describe("UPDATE_SEAT_CONFIG", () => {
    it("patches the matching seat config", () => {
      state = makeState({
        seats: [makeSeat({ seatId: "s1", label: "Alice", assigned: true })],
      });
      const next = reducer(state, {
        type: "UPDATE_SEAT_CONFIG",
        seatId: "s1",
        patch: { label: "Renamed", roleTitle: "Lead" },
      });
      expect(next.seats[0].label).toBe("Renamed");
      expect(next.seats[0].roleTitle).toBe("Lead");
    });

    it("resets fields when unassigning a seat", () => {
      state = makeState({
        seats: [
          makeSeat({
            seatId: "s1",
            label: "Alice",
            assigned: true,
            seatType: "agent",
            roleTitle: "Agent",
            spriteKey: "char_01",
            spritePath: "/chars/01.png",
            status: "running",
            runId: "run-1",
            taskSnippet: "work",
            startedAt: "2025-01-01",
            agentConfig: { agentId: "a1" },
          }),
        ],
      });
      const next = reducer(state, {
        type: "UPDATE_SEAT_CONFIG",
        seatId: "s1",
        patch: { assigned: false },
      });
      expect(next.seats[0].assigned).toBe(false);
      expect(next.seats[0].label).toBe("Alice"); // original label preserved
      expect(next.seats[0].seatType).toBe("worker");
      expect(next.seats[0].roleTitle).toBeUndefined();
      expect(next.seats[0].spriteKey).toBeUndefined();
      expect(next.seats[0].spritePath).toBeUndefined();
      expect(next.seats[0].status).toBe("empty");
      expect(next.seats[0].runId).toBeUndefined();
      expect(next.seats[0].taskSnippet).toBeUndefined();
      expect(next.seats[0].startedAt).toBeUndefined();
      expect(next.seats[0].agentConfig).toBeUndefined();
    });

    it("does not modify non-matching seats", () => {
      state = makeState({
        seats: [
          makeSeat({ seatId: "s1", label: "Alice" }),
          makeSeat({ seatId: "s2", label: "Bob" }),
        ],
      });
      const next = reducer(state, {
        type: "UPDATE_SEAT_CONFIG",
        seatId: "s1",
        patch: { label: "Carol" },
      });
      expect(next.seats[1].label).toBe("Bob");
    });
  });

  describe("RESET_SEATS", () => {
    it("resets all seats to empty, clears runtime fields", () => {
      state = makeState({
        seats: [
          makeSeat({
            seatId: "s1",
            status: "running",
            runId: "run-1",
            taskSnippet: "x",
            startedAt: "t",
          }),
          makeSeat({
            seatId: "s2",
            status: "done",
            runId: "run-2",
            taskSnippet: "y",
            startedAt: "t",
          }),
        ],
      });
      const next = reducer(state, { type: "RESET_SEATS" });
      for (const seat of next.seats) {
        expect(seat.status).toBe("empty");
        expect(seat.runId).toBeUndefined();
        expect(seat.taskSnippet).toBeUndefined();
        expect(seat.startedAt).toBeUndefined();
      }
    });

    it("preserves non-runtime fields", () => {
      state = makeState({
        seats: [makeSeat({ seatId: "s1", label: "Alice", assigned: true, spriteKey: "char_01" })],
      });
      const next = reducer(state, { type: "RESET_SEATS" });
      expect(next.seats[0].label).toBe("Alice");
      expect(next.seats[0].assigned).toBe(true);
      expect(next.seats[0].spriteKey).toBe("char_01");
    });
  });

  describe("RESTORE", () => {
    it("restores tasks, chatMessages, sessions, and activeSessionKey", () => {
      const tasks = [makeTask({ taskId: "t1" })];
      const chatMessages = [makeChat({ id: "c1" })];
      const sessions = [makeSession({ key: "s1" })];
      const next = reducer(state, {
        type: "RESTORE",
        tasks,
        chatMessages,
        sessions,
        activeSessionKey: "s1",
      });
      expect(next.tasks).toBe(tasks);
      expect(next.chatMessages).toEqual(chatMessages);
      expect(next.sessions).toBe(sessions);
      expect(next.activeSessionKey).toBe("s1");
    });

    it("filters out redundant connection messages", () => {
      const chatMessages = [
        makeChat({ id: "c1", role: "system", content: "Connected to ws://localhost" }),
        makeChat({ id: "c2", role: "user", content: "Hello" }),
      ];
      const next = reducer(state, {
        type: "RESTORE",
        tasks: [],
        chatMessages,
        sessions: [],
      });
      expect(next.chatMessages).toHaveLength(1);
      expect(next.chatMessages[0].id).toBe("c2");
    });

    it("falls back to existing activeSessionKey if none provided", () => {
      state = makeState({ activeSessionKey: "existing-key" });
      const next = reducer(state, {
        type: "RESTORE",
        tasks: [],
        chatMessages: [],
        sessions: [],
      });
      expect(next.activeSessionKey).toBe("existing-key");
    });

    it("preserves seats and connection", () => {
      const seats = [makeSeat({ seatId: "s1" })];
      state = makeState({ seats, connection: "connected" });
      const next = reducer(state, {
        type: "RESTORE",
        tasks: [],
        chatMessages: [],
        sessions: [],
      });
      expect(next.seats).toBe(seats);
      expect(next.connection).toBe("connected");
    });
  });

  describe("NEW_SESSION", () => {
    it("sets new session as active and resets seats and metrics", () => {
      state = makeState({
        seats: [makeSeat({ seatId: "s1", status: "running", runId: "run-1" })],
        sessionMetrics: { fresh: true, usedTokens: 500 },
      });
      const session = makeSession({ key: "new-key" });
      const next = reducer(state, { type: "NEW_SESSION", session });
      expect(next.activeSessionKey).toBe("new-key");
      expect(next.sessionMetrics).toEqual({ fresh: false });
      expect(next.seats[0].status).toBe("empty");
      expect(next.seats[0].runId).toBeUndefined();
    });

    it("prepends session to list and deduplicates", () => {
      const existing = makeSession({ key: "s1" });
      state = makeState({ sessions: [existing] });
      const newSession = makeSession({ key: "s1", label: "Updated" });
      const next = reducer(state, { type: "NEW_SESSION", session: newSession });
      expect(next.sessions).toHaveLength(1);
      expect(next.sessions[0]).toBe(newSession);
    });

    it("limits sessions to MAX_SESSIONS", () => {
      const sessions = Array.from({ length: 25 }, (_, i) =>
        makeSession({ key: `s${i}`, label: `Session ${i}` }),
      );
      state = makeState({ sessions });
      const newSession = makeSession({ key: "new" });
      const next = reducer(state, { type: "NEW_SESSION", session: newSession });
      expect(next.sessions.length).toBeLessThanOrEqual(20);
      expect(next.sessions[0].key).toBe("new");
    });
  });

  describe("SET_SESSIONS", () => {
    it("merges incoming sessions with existing, preserving local labels", () => {
      state = makeState({
        sessions: [makeSession({ key: "s1", label: "My Label" })],
      });
      const next = reducer(state, {
        type: "SET_SESSIONS",
        sessions: [makeSession({ key: "s1", label: "Server Label" })],
      });
      // existing label is preserved via the merge logic
      expect(next.sessions[0].label).toBe("My Label");
    });

    it("adds new incoming sessions", () => {
      state = makeState({ sessions: [makeSession({ key: "s1" })] });
      const next = reducer(state, {
        type: "SET_SESSIONS",
        sessions: [makeSession({ key: "s1" }), makeSession({ key: "s2" })],
      });
      expect(next.sessions.length).toBeGreaterThanOrEqual(2);
    });

    it("keeps local-only sessions", () => {
      state = makeState({
        sessions: [makeSession({ key: "local-only" }), makeSession({ key: "shared" })],
      });
      const next = reducer(state, {
        type: "SET_SESSIONS",
        sessions: [makeSession({ key: "shared" })],
      });
      const keys = next.sessions.map((s) => s.key);
      expect(keys).toContain("local-only");
      expect(keys).toContain("shared");
    });

    it("limits total sessions", () => {
      const many = Array.from({ length: 25 }, (_, i) => makeSession({ key: `s${i}` }));
      state = makeState({ sessions: many });
      const next = reducer(state, {
        type: "SET_SESSIONS",
        sessions: Array.from({ length: 25 }, (_, i) => makeSession({ key: `new${i}` })),
      });
      expect(next.sessions.length).toBeLessThanOrEqual(20);
    });
  });

  describe("HYDRATE_SESSION_CHAT", () => {
    it("replaces chat messages for a specific session and filters connection messages", () => {
      state = makeState({
        chatMessages: [
          makeChat({ id: "c1", sessionKey: "session-A", content: "old A" }),
          makeChat({ id: "c2", sessionKey: "session-B", content: "keep B" }),
        ],
      });
      const incoming = [makeChat({ id: "c3", sessionKey: "session-A", content: "new A" })];
      const next = reducer(state, {
        type: "HYDRATE_SESSION_CHAT",
        sessionKey: "session-A",
        chatMessages: incoming,
      });
      expect(next.chatMessages.find((m) => m.id === "c1")).toBeUndefined();
      expect(next.chatMessages.find((m) => m.id === "c2")).toBeDefined();
      expect(next.chatMessages.find((m) => m.id === "c3")).toBeDefined();
    });

    it("filters redundant connection messages from incoming", () => {
      const incoming = [
        makeChat({
          id: "c1",
          sessionKey: "session-A",
          role: "system",
          content: "Connected to ws://localhost",
        }),
        makeChat({ id: "c2", sessionKey: "session-A", content: "real message" }),
      ];
      const next = reducer(state, {
        type: "HYDRATE_SESSION_CHAT",
        sessionKey: "session-A",
        chatMessages: incoming,
      });
      expect(next.chatMessages.find((m) => m.id === "c1")).toBeUndefined();
      expect(next.chatMessages.find((m) => m.id === "c2")).toBeDefined();
    });
  });

  describe("SWITCH_SESSION", () => {
    it("sets activeSessionKey, resets metrics, and resets seat runtime", () => {
      state = makeState({
        seats: [
          makeSeat({
            seatId: "s1",
            status: "running",
            runId: "r1",
            taskSnippet: "x",
            startedAt: "t",
          }),
        ],
        sessionMetrics: { fresh: true, usedTokens: 1000 },
        activeSessionKey: "old-key",
      });
      const next = reducer(state, {
        type: "SWITCH_SESSION",
        sessionKey: "new-key",
      });
      expect(next.activeSessionKey).toBe("new-key");
      expect(next.sessionMetrics).toEqual({ fresh: false });
      expect(next.seats[0].status).toBe("empty");
      expect(next.seats[0].runId).toBeUndefined();
    });
  });

  describe("unknown action", () => {
    it("returns the state unchanged", () => {
      const next = reducer(state, { type: "UNKNOWN_ACTION" } as unknown as Action);
      expect(next).toBe(state);
    });
  });
});
