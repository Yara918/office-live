import type * as Phaser from "phaser";
import type { Direction } from "../../config/animations";
import type { ChatBubble } from "../ChatBubble";
import type { Pathfinder, PathPoint } from "../../utils/Pathfinder";
import type { POIDef } from "../../utils/MapHelpers";

export type WorkerStatus = "idle" | "working" | "done" | "failed";

export type POI = POIDef;

export type QueuedTask = {
  runId: string;
  message: string;
  onReady?: () => void;
};

/**
 * Shared mutable context exposed to movement, task, and idle sub-modules.
 * Implemented by the Worker class itself — no separate object needed.
 */
export interface WorkerCtx {
  readonly scene: Phaser.Scene;
  readonly sprite: Phaser.Physics.Arcade.Sprite;
  readonly bubble: ChatBubble;
  readonly spriteKey: string;
  readonly homeX: number;
  readonly homeY: number;
  readonly initialFacing: Direction;

  // Mutable state accessed by sub-modules
  facing: Direction;
  moveTarget: { x: number; y: number } | null;
  currentPath: PathPoint[];
  pathIndex: number;
  isReturningHome: boolean;
  faceTarget: { x: number; y: number } | null;
  arrivalFacing: Direction | null;
  onArrival: (() => void) | null;
  stuckFrames: number;
  lastX: number;
  lastY: number;
  pathfinder: Pathfinder | null;

  // Idle / wander state
  canWander: boolean;
  isWandering: boolean;
  pois: POI[];
  wanderTimer: Phaser.Time.TimerEvent | null;
  activityTimer: Phaser.Time.TimerEvent | null;
  interactionLocked: boolean;

  // Task state
  _status: WorkerStatus;
  assignedRunId: string | null;
  currentTaskMessage: string | null;
  taskQueue: QueuedTask[];
  taskVisualTimer: Phaser.Time.TimerEvent | null;

  // Methods the sub-modules may call on Worker
  showBubble(message: string, ttl?: number): void;
  showEmote(emoteKey: string): void;
  hideEmote(): void;
  setStatus(status: WorkerStatus): void;
  navigateTo(x: number, y: number, facePoi?: { x: number; y: number }): void;
  navigateHome(): void;
  stopIdleActivity(): void;
  scheduleWander(): void;
}
