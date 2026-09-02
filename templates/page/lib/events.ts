import type { SeatState } from "@/types/game";
import type { SeatDef } from "@/components/game/utils/MapHelpers";
import { createLogger } from "./logger";

export type OfficeActivityMode =
  | "focus"
  | "thinking"
  | "music"
  | "drink"
  | "oneToOne"
  | "group"
  | "allHands"
  | "rest"
  | "exercise"
  | "game"
  | "read"
  | "chat"
  | "coffee"
  | "delegate"
  | "review"
  | "kpi"
  | "negotiate"
  | "copy"
  | "print"
  | "water"
  | "standup"
  | "brainstorm"
  | "demo"
  | "lunch"
  | "plant"
  | "stretch"
  | "focus_group"
  | "handover"
  | "teambuild"
  | "book_read"
  | "roundtable"
  | "device_check"
  | "walk";

const log = createLogger("GameEventBus");

export interface GameEventMap {
  "seats-discovered": [seats: SeatDef[]];
  "seat-configs-updated": [seats: SeatState[]];
  "task-assigned": [taskId: string, message: string, seatId?: string, sessionKey?: string];
  "task-routed": [taskId: string, seatId: string, actorName: string];
  "task-ready": [taskId: string, message: string, seatId?: string];
  "task-bound": [taskId: string, runId: string];
  "task-staged": [taskId: string, stage: "queued" | "returning", seatId?: string];
  "task-bubble": [runId: string, text: string, ttl: number];
  "task-aborted": [runId: string];
  "task-completed": [runId: string];
  "task-failed": [runId: string];
  "subagent-assigned": [runId: string, parentRunId: string, label: string, seatId?: string];
  "open-terminal": [seatId?: string];
  "open-terminal-queue": [seatId: string];
  "open-person-detail": [seatId: string];
  "open-reassign-panel": [seatId: string, taskId?: string];
  "request-admin": [];
  "admin-unlocked": [];
  "office-activity": [
    payload: {
      mode: OfficeActivityMode;
      actorSeatId?: string;
      targetSeatIds: string[];
    },
  ];
  "stop-task": [runId: string, seatId: string];
  "terminal-closed": [];
  "new-session-for-seat": [seatId: string];
  "open-session-history": [seatId: string];
}

type Listener<T extends unknown[]> = (...args: T) => void;

class GameEventBus {
  private listeners = new Map<string, Set<Listener<unknown[]>>>();

  on<K extends keyof GameEventMap>(event: K, fn: Listener<GameEventMap[K]>): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn as Listener<unknown[]>);
    return () => this.off(event, fn);
  }

  off<K extends keyof GameEventMap>(event: K, fn: Listener<GameEventMap[K]>) {
    this.listeners.get(event)?.delete(fn as Listener<unknown[]>);
  }

  emit<K extends keyof GameEventMap>(event: K, ...args: GameEventMap[K]) {
    this.listeners.get(event)?.forEach((fn) => {
      try {
        fn(...args);
      } catch (err) {
        log.error(`listener error on "${event}":`, err);
      }
    });
  }
}

// 浏览器全局单例：React 面板与动态加载的 Phaser 模块必须复用同一个事件总线，
// 否则 emit 与 on 落在不同实例上，事件静默丢失（互动玩法不生效的根因）
declare global {
  interface Window {
    __officeLiveGameEvents__?: GameEventBus;
  }
  var __officeLiveGameEvents__: GameEventBus | undefined;
}

const globalEventHost = (typeof window !== "undefined" ? window : globalThis) as {
  __officeLiveGameEvents__?: GameEventBus;
};

export const gameEvents: GameEventBus =
  globalEventHost.__officeLiveGameEvents__ ??
  (globalEventHost.__officeLiveGameEvents__ = new GameEventBus());
