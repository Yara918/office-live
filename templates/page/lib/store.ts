"use client";

import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useRef,
  useEffect,
  type Dispatch,
  type ReactNode,
} from "react";
import React from "react";
import type { SeatState, TaskItem, GatewayConfig, ChatMessage } from "@/types/game";
import type { StudioSnapshot } from "@/types/game";
import { gameEvents } from "./events";
import { withBase } from "./base-path";
import {
  type PersistedSeatConfig,
  loadGatewayConfig,
  loadActiveSessionKey,
  loadTasks,
  loadChat,
  loadSessions,
  saveTasks,
  saveChat,
  saveSessions,
  saveActiveSessionKey,
} from "./persistence";
import {
  type Action,
  reducer,
  initialState,
  findTask,
  mergeDiscoveredSeats,
  MAIN_SESSION_KEY,
} from "./reducer";
import { useGateway } from "./hooks/useGateway";
import { useSession } from "./hooks/useSession";
import { useTaskRouter } from "./hooks/useTaskRouter";
import { getAgentProvider, getDefaultGatewayUrl } from "./utils";

// ── Context ────────────────────────────────────────────

interface StudioContextValue {
  state: StudioSnapshot;
  connect: (config?: GatewayConfig) => void;
  disconnect: () => void;
  assignTask: (message: string, seatId?: string) => void;
  updateSeatConfig: (seatId: string, patch: Partial<SeatState>) => void;
  newSession: () => void;
  switchSession: (sessionKey: string) => void;
  prepareSessionForSeat: (seatId: string) => Promise<void>;
  newSessionForSeat: (seatId: string) => void;
  getBoundSessionForSeat: (seatId: string) => string | undefined;
  loadSessionChat: (sessionKey: string) => Promise<ChatMessage[]>;
}

const StudioContext = createContext<StudioContextValue | null>(null);

export function useStudio(): StudioContextValue {
  const ctx = useContext(StudioContext);
  if (!ctx) throw new Error("useStudio must be used within StudioProvider");
  return ctx;
}

// ── Provider ───────────────────────────────────────────

export function StudioProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const dispatchRef = useRef<Dispatch<Action>>(dispatch);
  dispatchRef.current = dispatch;
  const tasksRef = useRef<TaskItem[]>(state.tasks);
  tasksRef.current = state.tasks;
  const seatsRef = useRef<SeatState[]>(state.seats);
  seatsRef.current = state.seats;
  const seatConfigRef = useRef<PersistedSeatConfig[]>([]);
  const activeSessionKeyRef = useRef<string | undefined>(undefined);
  const taskCounterRef = useRef(0);

  const setActiveSessionKey = useCallback((sessionKey?: string) => {
    activeSessionKeyRef.current = sessionKey;
    saveActiveSessionKey(sessionKey);
    dispatchRef.current({ type: "SET_ACTIVE_SESSION", sessionKey });
  }, []);

  // ── Gateway hook ──
  const gateway = useGateway({
    dispatch: dispatchRef,
    tasks: tasksRef,
    seats: seatsRef,
    activeSessionKey: activeSessionKeyRef,
    setActiveSessionKey,
    taskCounter: taskCounterRef,
  });

  const setActiveSessionKeyDirect = useCallback((key: string | undefined) => {
    activeSessionKeyRef.current = key;
  }, []);

  // ── Session hook ──
  const session = useSession({
    dispatch: dispatchRef,
    clientRef: gateway.clientRef,
    activeSessionKey: activeSessionKeyRef,
    setActiveSessionKey: setActiveSessionKeyDirect,
    seenStarts: gateway.seenStartsRef,
    bubbleAccum: gateway.bubbleAccumRef,
    stoppedRunIds: gateway.stoppedRunIdsRef,
  });

  // ── Task router hook ──
  const taskRouter = useTaskRouter({
    dispatch: dispatchRef,
    clientRef: gateway.clientRef,
    tasks: tasksRef,
    seats: seatsRef,
    activeSessionKey: activeSessionKeyRef,
    seatIdToSessionKey: session.seatIdToSessionKeyRef,
    stoppedRunIds: gateway.stoppedRunIdsRef,
    runActors: gateway.runActorRef,
    nextTaskId: () => `aw_task_${++taskCounterRef.current}_${Date.now()}`,
  });

  // ── Bootstrap: restore persisted state + auto-connect ──
  const inflightTaskIdsRef = useRef<string[]>([]);

  useEffect(() => {
    // 一次性清理旧版座位缓存（旧数据会导致先显示旧成员、后加载新成员）
    try {
      if (typeof window !== "undefined") window.localStorage.removeItem("office-live:seat-config:v1");
    } catch {
      /* ignore */
    }

    const savedConfig = loadGatewayConfig();
    if (savedConfig) gateway.configRef.current = savedConfig;

    const savedActiveKey = loadActiveSessionKey();
    const fallbackSessionKey = savedActiveKey ?? MAIN_SESSION_KEY;
    const tasks = loadTasks(fallbackSessionKey);
    const chat = loadChat(fallbackSessionKey);
    const sessions = loadSessions();
    // 座位完全以飞书快照为准，不使用本地缓存（避免旧数据先显示、新数据后加载）
    seatConfigRef.current = [];
    const hasRestoredData = tasks.length > 0 || chat.length > 0 || sessions.length > 0;
    activeSessionKeyRef.current =
      savedActiveKey ?? (hasRestoredData ? MAIN_SESSION_KEY : undefined);

    if (hasRestoredData) {
      dispatch({
        type: "RESTORE",
        tasks,
        chatMessages: chat,
        sessions,
        activeSessionKey: fallbackSessionKey,
      });
    }
    if (activeSessionKeyRef.current) {
      dispatch({ type: "SET_ACTIVE_SESSION", sessionKey: activeSessionKeyRef.current });
      saveActiveSessionKey(activeSessionKeyRef.current);
    }

    // Track inflight tasks so other effects can reference them
    const inflight = tasks.filter(
      (t) => t.status === "running" || t.status === "submitted" || t.status === "returning",
    );
    inflightTaskIdsRef.current = inflight.map((t) => t.taskId);
    for (const t of inflight) {
      if (t.runId) gateway.seenStartsRef.current.add(t.runId);
      gateway.seenStartsRef.current.add(t.taskId);
      if (t.actorName && t.runId) gateway.runActorRef.current.set(t.runId, t.actorName);
    }

    // Auto-connect: immediately for Auggie (no config needed), or if config was saved for OpenClaw
    if (getAgentProvider() === "auggie") {
      const t = setTimeout(
        () => gateway.connectImpl({ url: getDefaultGatewayUrl(), token: "" }),
        80,
      );
      return () => clearTimeout(t);
    }
    if (savedConfig?.url) {
      const t = setTimeout(() => gateway.connectImpl(savedConfig), 80);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Seat sync: merge discovered seats with persisted configs ──
  useEffect(() => {
    const unsub = gameEvents.on("seats-discovered", (discovered) => {
      const mergedSeats = mergeDiscoveredSeats(discovered, seatConfigRef.current, seatsRef.current);
      dispatchRef.current({ type: "SYNC_SEATS", seats: mergedSeats });

      for (const task of tasksRef.current) {
        if (
          task.seatId &&
          (task.status === "running" || task.status === "submitted" || task.status === "returning")
        ) {
          dispatchRef.current({
            type: "PATCH_SEAT_RUNTIME",
            seatId: task.seatId,
            patch: {
              status: task.status === "returning" ? "returning" : "running",
              runId: task.runId ?? task.taskId,
              taskSnippet: task.message.slice(0, 28),
              startedAt: task.createdAt,
            },
          });
        }
      }
    });
    return unsub;
  }, []);

  // ── Stale task cleanup: mark inflight tasks as interrupted after timeout ──
  useEffect(() => {
    const inflightIds = inflightTaskIdsRef.current;
    if (inflightIds.length === 0) return;

    const timer = setTimeout(() => {
      for (const taskId of inflightIds) {
        const current = findTask(tasksRef.current, taskId);
        if (
          current &&
          (current.status === "running" ||
            current.status === "submitted" ||
            current.status === "returning")
        ) {
          dispatchRef.current({
            type: "UPDATE_TASK",
            taskId: current.taskId,
            patch: { status: "interrupted", completedAt: new Date().toISOString() },
          });
          if (current.runId) {
            dispatchRef.current({
              type: "SET_SEAT_STATUS",
              runId: current.runId,
              status: "empty",
            });
          }
        }
      }
    }, 20_000);

    return () => clearTimeout(timer);
  }, []);

  // ── Persist tasks + chat + sessions ──
  useEffect(() => {
    saveTasks(state.tasks);
    saveChat(state.chatMessages);
    saveSessions(state.sessions);
  }, [state.tasks, state.chatMessages, state.sessions]);

  useEffect(() => {
    const configs: PersistedSeatConfig[] = state.seats.map((seat) => ({
      seatId: seat.seatId,
      label: seat.label,
      seatType: seat.seatType,
      roleTitle: seat.roleTitle,
      assigned: seat.assigned,
      spriteKey: seat.spriteKey,
      spritePath: seat.spritePath,
      agentConfig: seat.agentConfig,
    }));
    seatConfigRef.current = configs;
    gameEvents.emit("seat-configs-updated", state.seats);

    // Sync worker roster to server for auggie MCP dispatch
    if (typeof window !== "undefined") {
      fetch(withBase("/api/internal/seat-sync"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seats: configs }),
      }).catch(() => {
        /* ignore — endpoint only exists in auggie mode */
      });
    }
  }, [state.seats]);

  // ── Cleanup ──
  useEffect(() => {
    const sessionTimer = gateway.sessionRefreshTimerRef;
    const bubbleTimers = gateway.bubbleThrottleTimersRef;
    const client = gateway.clientRef;
    return () => {
      if (sessionTimer.current) {
        clearTimeout(sessionTimer.current);
      }
      for (const timer of bubbleTimers.current.values()) {
        clearTimeout(timer);
      }
      client.current?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateSeatConfig = useCallback((seatId: string, patch: Partial<SeatState>) => {
    dispatchRef.current({ type: "UPDATE_SEAT_CONFIG", seatId, patch });
  }, []);

  return React.createElement(
    StudioContext.Provider,
    {
      value: {
        state,
        connect: gateway.connect,
        disconnect: gateway.disconnect,
        assignTask: taskRouter.assignTask,
        updateSeatConfig,
        newSession: session.newSession,
        switchSession: session.switchSession,
        prepareSessionForSeat: session.prepareSessionForSeat,
        newSessionForSeat: session.newSessionForSeat,
        getBoundSessionForSeat: session.getBoundSessionForSeat,
        loadSessionChat: session.loadSessionChat,
      },
    },
    children,
  );
}
