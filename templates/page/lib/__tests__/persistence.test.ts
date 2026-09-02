import { describe, it, expect, beforeEach, vi } from "vitest";

import { LS_TASKS, LS_CHAT, LS_SESSIONS, LS_ACTIVE_KEY, DEFAULT_BGM_VOLUME } from "@/lib/constants";

import type { GatewayConfig, TaskItem, ChatMessage, SessionRecord } from "@/types/game";
import type { PersistedSeatConfig } from "@/lib/persistence";

// ── localStorage mock ────────────────────────────────────

function createLocalStorageMock() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => {
      store.clear();
    }),
    get length() {
      return store.size;
    },
    key: vi.fn(() => null),
    _store: store,
  } satisfies Storage & { _store: Map<string, string> };
}

let storage: ReturnType<typeof createLocalStorageMock>;

beforeEach(() => {
  storage = createLocalStorageMock();
  Object.defineProperty(globalThis, "window", {
    value: globalThis,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    writable: true,
    configurable: true,
  });
});

// We re-import the module for each test group so the module-level
// `typeof window` check inside lsGet sees our mock.
// Because vitest caches modules we use dynamic import after setting up mocks.

async function loadModule() {
  // resetModules is not needed – the module has no top-level side effects
  // and every call re-evaluates `typeof window` at runtime.
  return await import("@/lib/persistence");
}

// ── Helpers to build stub data ──────────────────────────

function makeTask(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    taskId: `task-${Math.random().toString(36).slice(2, 8)}`,
    message: "do something",
    status: "submitted",
    sessionKey: "sess-1",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeChatMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    runId: "run-1",
    timestamp: new Date().toISOString(),
    sessionKey: "sess-1",
    role: "user",
    content: "hello",
    ...overrides,
  } as ChatMessage;
}

function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    key: `sess-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeSeatConfig(overrides: Partial<PersistedSeatConfig> = {}): PersistedSeatConfig {
  return {
    seatId: `seat-${Math.random().toString(36).slice(2, 8)}`,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────

describe("lsGet", () => {
  it("returns fallback when key is missing", async () => {
    const { lsGet } = await loadModule();
    expect(lsGet("nonexistent-key", 42)).toBe(42);
  });

  it("returns parsed value when key has valid JSON", async () => {
    const { lsGet } = await loadModule();
    storage.setItem("test-key", JSON.stringify({ a: 1 }));
    expect(lsGet("test-key", {})).toEqual({ a: 1 });
  });

  it("returns fallback when stored value is corrupted JSON", async () => {
    const { lsGet } = await loadModule();
    storage.setItem("bad-json", "{not valid json!!");
    expect(lsGet("bad-json", "fallback")).toBe("fallback");
  });

  it("returns fallback when window is undefined (server-side)", async () => {
    const { lsGet } = await loadModule();

    const origWindow = globalThis.window;
    // @ts-expect-error -- intentionally removing window to simulate SSR
    delete globalThis.window;

    try {
      expect(lsGet("any-key", "server-fallback")).toBe("server-fallback");
    } finally {
      // restore so other tests are not affected
      Object.defineProperty(globalThis, "window", {
        value: origWindow,
        writable: true,
        configurable: true,
      });
    }
  });
});

describe("lsSet", () => {
  it("writes JSON to localStorage", async () => {
    const { lsSet } = await loadModule();
    lsSet("write-key", { x: 10 });
    expect(storage.setItem).toHaveBeenCalledWith("write-key", JSON.stringify({ x: 10 }));
    expect(JSON.parse(storage._store.get("write-key")!)).toEqual({ x: 10 });
  });

  it("handles quota exceeded error gracefully", async () => {
    const { lsSet } = await loadModule();

    storage.setItem.mockImplementationOnce(() => {
      throw new DOMException("QuotaExceededError", "QuotaExceededError");
    });

    // Should not throw even when localStorage quota is exceeded
    expect(() => lsSet("big-key", "x".repeat(100))).not.toThrow();
  });
});

describe("saveTasks / loadTasks", () => {
  it("round-trips tasks", async () => {
    const { saveTasks, loadTasks } = await loadModule();
    const tasks = [makeTask({ sessionKey: "s1" }), makeTask({ sessionKey: "s2" })];
    saveTasks(tasks);
    const loaded = loadTasks("fallback");
    expect(loaded).toEqual(tasks);
  });

  it("caps saved tasks at 200", async () => {
    const { saveTasks } = await loadModule();
    const tasks = Array.from({ length: 250 }, (_, i) => makeTask({ taskId: `t-${i}` }));
    saveTasks(tasks);

    const raw = JSON.parse(storage._store.get(LS_TASKS)!) as TaskItem[];
    expect(raw).toHaveLength(200);
    // Should keep the first 200
    expect(raw[0].taskId).toBe("t-0");
    expect(raw[199].taskId).toBe("t-199");
  });

  it("adds fallbackSessionKey when task.sessionKey is missing", async () => {
    const { loadTasks } = await loadModule();
    const taskWithoutKey = { ...makeTask(), sessionKey: undefined };
    storage.setItem(LS_TASKS, JSON.stringify([taskWithoutKey]));

    const loaded = loadTasks("my-fallback");
    expect(loaded[0].sessionKey).toBe("my-fallback");
  });
});

describe("saveChat / loadChat", () => {
  it("round-trips chat messages", async () => {
    const { saveChat, loadChat } = await loadModule();
    const msgs = [makeChatMessage({ content: "hi" }), makeChatMessage({ content: "there" })];
    saveChat(msgs);
    const loaded = loadChat("fallback");
    expect(loaded).toEqual(msgs);
  });

  it("caps saved chat to 400 most recent messages", async () => {
    const { saveChat } = await loadModule();
    const msgs = Array.from({ length: 500 }, (_, i) => makeChatMessage({ id: `m-${i}` }));
    saveChat(msgs);

    const raw = JSON.parse(storage._store.get(LS_CHAT)!) as ChatMessage[];
    expect(raw).toHaveLength(400);
    // slice(-400) keeps the LAST 400
    expect(raw[0].id).toBe("m-100");
    expect(raw[399].id).toBe("m-499");
  });

  it("adds fallbackSessionKey when msg.sessionKey is missing", async () => {
    const { loadChat } = await loadModule();
    const msgWithoutKey = { ...makeChatMessage(), sessionKey: undefined };
    storage.setItem(LS_CHAT, JSON.stringify([msgWithoutKey]));

    const loaded = loadChat("chat-fallback");
    expect(loaded[0].sessionKey).toBe("chat-fallback");
  });
});

describe("gateway config", () => {
  it("round-trips GatewayConfig", async () => {
    const { saveGatewayConfig, loadGatewayConfig } = await loadModule();
    const config: GatewayConfig = { url: "https://gw.test", token: "tok-123" };
    saveGatewayConfig(config);
    expect(loadGatewayConfig()).toEqual(config);
  });

  it("returns null when nothing is stored", async () => {
    const { loadGatewayConfig } = await loadModule();
    expect(loadGatewayConfig()).toBeNull();
  });
});

describe("active session key", () => {
  it("round-trips a session key", async () => {
    const { saveActiveSessionKey, loadActiveSessionKey } = await loadModule();
    saveActiveSessionKey("sess-abc");
    expect(loadActiveSessionKey()).toBe("sess-abc");
  });

  it("stores null when key is undefined", async () => {
    const { saveActiveSessionKey, loadActiveSessionKey } = await loadModule();
    saveActiveSessionKey(undefined);
    const raw = storage._store.get(LS_ACTIVE_KEY);
    expect(raw).toBe("null");
    expect(loadActiveSessionKey()).toBeNull();
  });

  it("returns null when nothing stored", async () => {
    const { loadActiveSessionKey } = await loadModule();
    expect(loadActiveSessionKey()).toBeNull();
  });
});

describe("sessions", () => {
  it("round-trips sessions", async () => {
    const { saveSessions, loadSessions } = await loadModule();
    const sessions = [makeSession(), makeSession()];
    saveSessions(sessions);
    expect(loadSessions()).toEqual(sessions);
  });

  it("caps sessions at MAX_SESSIONS (20)", async () => {
    const { saveSessions } = await loadModule();
    const sessions = Array.from({ length: 30 }, (_, i) => makeSession({ key: `s-${i}` }));
    saveSessions(sessions);

    const raw = JSON.parse(storage._store.get(LS_SESSIONS)!) as SessionRecord[];
    expect(raw).toHaveLength(20);
  });
});

describe("seat configs", () => {
  it("round-trips seat configs", async () => {
    const { saveSeatConfigs, loadSeatConfigs } = await loadModule();
    const configs = [makeSeatConfig({ label: "Dev" }), makeSeatConfig({ label: "QA" })];
    saveSeatConfigs(configs);
    expect(loadSeatConfigs()).toEqual(configs);
  });

  it("returns empty array when nothing stored", async () => {
    const { loadSeatConfigs } = await loadModule();
    expect(loadSeatConfigs()).toEqual([]);
  });
});

describe("BGM volume", () => {
  it("round-trips volume", async () => {
    const { saveBgmVolume, loadBgmVolume } = await loadModule();
    saveBgmVolume(0.8);
    expect(loadBgmVolume()).toBe(0.8);
  });

  it("returns DEFAULT_BGM_VOLUME when nothing stored", async () => {
    const { loadBgmVolume } = await loadModule();
    expect(loadBgmVolume()).toBe(DEFAULT_BGM_VOLUME);
  });
});

describe("onboarding", () => {
  it("returns false by default", async () => {
    const { loadOnboardingDone } = await loadModule();
    expect(loadOnboardingDone()).toBe(false);
  });

  it("round-trips onboarding flag", async () => {
    const { saveOnboardingDone, loadOnboardingDone } = await loadModule();
    saveOnboardingDone();
    expect(loadOnboardingDone()).toBe(true);
  });
});
