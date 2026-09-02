import * as Phaser from "phaser";
import { Worker, type POI } from "../entities/Worker";
import type { Direction } from "../config/animations";
import type { Pathfinder } from "../utils/Pathfinder";
import type { SeatDef } from "../utils/MapHelpers";
import type { SeatState } from "@/types/game";
import { OFFICE_CONFIG } from "@/lib/office-config";

export class WorkerManager {
  private scene: Phaser.Scene;
  private pois: POI[];
  private pathfinder: Pathfinder;

  workers: Worker[] = [];
  runWorkerMap = new Map<string, Worker>();
  seatDefs: SeatDef[] = [];

  constructor(scene: Phaser.Scene, seatDefs: SeatDef[], pois: POI[], pathfinder: Pathfinder) {
    this.scene = scene;
    this.seatDefs = seatDefs;
    this.pois = pois;
    this.pathfinder = pathfinder;
  }

  spawnWorker(seatDef: SeatDef, seat: SeatState): Worker | null {
    if (!seat.spriteKey) return null;
    const initialFacing: Direction = seatDef.facing;
    const worker = new Worker(
      this.scene,
      seatDef.x,
      seatDef.y,
      seat.spriteKey,
      seatDef.seatId,
      seat.label,
      initialFacing,
    );
    worker.setPOIs(this.pois);
    worker.setPathfinder(this.pathfinder);
    worker.sprite.setCollideWorldBounds(true);
    // 配置的表格维护人（负责人）：头顶常驻 E 标识
    worker.setOwner(seat.label === OFFICE_CONFIG.ownerName);
    return worker;
  }

  /** 查找负责人（表格维护人）对应的 Worker */
  findOwner(): Worker | null {
    return this.workers.find((worker) => worker.isOwner) ?? null;
  }

  syncWorkers(seats: SeatState[], clearNearest: (worker: Worker) => void) {
    const nextBySeatId = new Map(
      seats.filter((seat) => seat.assigned && seat.spriteKey).map((seat) => [seat.seatId, seat]),
    );
    const existingBySeatId = new Map(this.workers.map((worker) => [worker.seatId, worker]));
    const nextWorkers: Worker[] = [];

    for (const seatDef of this.seatDefs) {
      const seat = nextBySeatId.get(seatDef.seatId);
      const existing = existingBySeatId.get(seatDef.seatId);

      if (!seat) {
        if (existing) {
          this.cleanupWorkerRunIds(existing);
          clearNearest(existing);
          existing.destroy();
          existingBySeatId.delete(seatDef.seatId);
        }
        continue;
      }

      const needsRecreate =
        !existing || existing.spriteKey !== seat.spriteKey || existing.label !== seat.label;

      if (needsRecreate) {
        if (existing) {
          this.cleanupWorkerRunIds(existing);
          clearNearest(existing);
          existing.destroy();
          existingBySeatId.delete(seatDef.seatId);
        }
        const created = this.spawnWorker(seatDef, seat);
        if (created) nextWorkers.push(created);
        continue;
      }

      nextWorkers.push(existing);
      existingBySeatId.delete(seatDef.seatId);
    }

    for (const stale of existingBySeatId.values()) {
      this.cleanupWorkerRunIds(stale);
      clearNearest(stale);
      stale.destroy();
    }

    this.workers = nextWorkers;
  }

  cleanupWorkerRunIds(worker: Worker) {
    if (worker.assignedRunId) this.runWorkerMap.delete(worker.assignedRunId);
    for (const task of worker.taskQueue) {
      this.runWorkerMap.delete(task.runId);
    }
  }

  findBySeatId(seatId?: string): Worker | null {
    if (!seatId) return null;
    return this.workers.find((worker) => worker.seatId === seatId) ?? null;
  }

  /** 点击命中检测：返回 (x,y) 附近最近的可交互成员（半径覆盖头顶标识） */
  findNearestAt(x: number, y: number, radius = 90): Worker | null {
    let nearest: Worker | null = null;
    let minDist = radius * radius;
    for (const worker of this.workers) {
      if (!worker.canInteract()) continue;
      // 命中检测中心放在角色身体上方（覆盖头顶 E 标识区域）
      const hitY = worker.sprite.y - 40;
      const dx = worker.sprite.x - x;
      const dy = hitY - y;
      const d = dx * dx + dy * dy;
      if (d < minDist) {
        minDist = d;
        nearest = worker;
      }
    }
    return nearest;
  }

  findIdle(): Worker | null {
    return this.workers.find((worker) => worker.status === "idle") ?? null;
  }

  updateAll() {
    for (const worker of this.workers) worker.update();
  }

  destroyAll() {
    for (const worker of this.workers) worker.destroy();
    this.workers = [];
    this.runWorkerMap.clear();
  }
}
