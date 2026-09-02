import { gameEvents } from "@/lib/events";
import type { WorkerManager } from "./WorkerManager";
import type { InteractionManager } from "./InteractionManager";
import type { Worker } from "../entities/Worker";

/** 场景目标点（已避开碰撞，成员可达）。key 与互动动作 mode 对应。 */
const SCENE_SPOTS: Record<string, { x: number; y: number }> = {
  bookshelf: { x: 481, y: 271 },
  bookshelf2: { x: 934, y: 272 },
  bookshelf3: { x: 1150, y: 290 },
  bookshelf4: { x: 930, y: 430 },
  whiteboard: { x: 336, y: 258 },
  whiteboard2: { x: 576, y: 259 },
  printer: { x: 674, y: 332 },
  water: { x: 743, y: 280 },
  water2: { x: 551, y: 663 },
  sofa: { x: 337, y: 681 },
  workbench: { x: 900, y: 850 },
  meetTable: { x: 890, y: 740 },
  corridor: { x: 1000, y: 430 },
  diningTable: { x: 870, y: 590 },
  openArea: { x: 700, y: 450 },
  rightSeat: { x: 850, y: 545 },
};

function uniqueWorkers(workers: Array<Worker | null>) {
  const seen = new Set<string>();
  return workers.filter((worker): worker is Worker => {
    if (!worker || seen.has(worker.seatId)) return false;
    seen.add(worker.seatId);
    return true;
  });
}

/** 右侧桌椅区的多个可站座位：覆盖 3 张独立桌子 + 走道，多人去时分散到不同桌 */
const RIGHT_SEATS = [
  { x: 828, y: 528 }, // 桌1
  { x: 1060, y: 528 }, // 桌2
  { x: 1099, y: 500 }, // 桌3
  { x: 1020, y: 500 }, // 桌2 另一侧
  { x: 972, y: 620 }, // 走道位
  { x: 828, y: 528 }, // 桌1（循环）
];

/** 单人动作：先走到对应场景点，到达后表演（气泡+表情），停留后回工位 */
function runSceneActivity(worker: Worker, spotKey: string | null, emote: string, text: string) {
  worker.stopIdleActivity();
  worker.canWander = false;
  worker.performing = true; // 表演中标记：防止"卡住自愈"误判打断
  worker.hideEmote();
  worker.bubble.hide();

  const spot = spotKey ? SCENE_SPOTS[spotKey] : null;
  if (!spot) {
    // 无场景点：原地表演
    worker.showEmote(emote);
    worker.showBubble(text, 4200);
    worker.scene.time.delayedCall(6500, () => {
      worker.hideEmote();
      worker.performing = false;
      worker.canWander = true;
      worker.scheduleWander();
    });
    return;
  }

  // 先走过去，到达后再表演
  worker.navigateTo(spot.x, spot.y, { x: spot.x, y: spot.y });
  worker.onArrival = () => {
    worker.showEmote(emote);
    worker.showBubble(text, 4200);
    // 表演一段时间后回工位
    worker.scene.time.delayedCall(6000, () => {
      worker.hideEmote();
      worker.onArrival = () => {
        worker.performing = false;
        worker.canWander = true;
        worker.scheduleWander();
      };
      worker.navigateHome();
    });
  };
}

function runDeskActivity(worker: Worker, emote: string, text: string) {
  runSceneActivity(worker, null, emote, text);
}

/** 多人去右侧桌椅区：按人数分散到不同座位（不挤同一张） */
function runRightSeats(workers: Worker[], text: string) {
  if (workers.length === 0) return;
  workers.forEach((worker, index) => {
    // 互动优先：中止任务、解除锁定
    if (worker.assignedRunId) {
      worker.abortTask(worker.assignedRunId);
      worker.assignedRunId = null;
    }
    worker.interactionLocked = false;
    worker.setStatus("idle");
    const seat = RIGHT_SEATS[index % RIGHT_SEATS.length];
    worker.stopIdleActivity();
    worker.canWander = false;
    worker.performing = true;
    worker.hideEmote();
    worker.bubble.hide();
    worker.navigateTo(seat.x, seat.y, { x: seat.x, y: seat.y });
    worker.onArrival = () => {
      worker.showEmote("emote:sleep");
      worker.showBubble(text, 4200);
      worker.scene.time.delayedCall(6000, () => {
        worker.hideEmote();
        worker.onArrival = () => {
          worker.performing = false;
          worker.canWander = true;
          worker.scheduleWander();
        };
        worker.navigateHome();
      });
    };
  });
}

/** 中央空旷聚集点（全员开会用，已验证可达） */
const GATHER_SPOT = { x: 550, y: 540 };

/**
 * 多人沟通（1对1/小组）：发起人原地（在工位/原地），参与人走到他旁边围成一圈。
 * 适合：安排工作、绩效沟通、洽谈、需求对齐、资料传递、闲聊、交接等——"来找我聊"。
 */
function runGroupActivity(workers: Worker[], text: string) {
  if (workers.length === 0) return;
  const anchor = workers[0];

  workers.forEach((worker, index) => {
    // 互动优先：中止任务、解除锁定，确保发起人也响应互动
    if (worker.assignedRunId) {
      worker.abortTask(worker.assignedRunId);
      worker.assignedRunId = null;
    }
    worker.interactionLocked = false;
    worker.setStatus("idle");
    worker.stopIdleActivity();
    worker.canWander = false;
    worker.performing = true;
    worker.hideEmote();
    worker.bubble.hide();

    if (index === 0) {
      // 发起人：原地等，朝向第一个参与人，直接开始表演
      const faceTarget = workers[1]
        ? { x: workers[1].sprite.x, y: workers[1].sprite.y }
        : undefined;
      worker.showBubble(text, 4000);
      worker.showEmote("emote:star");
      if (faceTarget) worker.navigateTo(worker.sprite.x, worker.sprite.y, faceTarget);
      worker.scene.time.delayedCall(9000, () => {
        worker.hideEmote();
        worker.onArrival = () => {
          worker.performing = false;
          worker.canWander = true;
          worker.scheduleWander();
        };
        worker.navigateHome();
      });
      return;
    }

    // 参与人：先走到发起人旁边，到达后再表演，停留后回工位
    worker.navigateTo(anchor.sprite.x, anchor.sprite.y, { x: anchor.sprite.x, y: anchor.sprite.y });
    worker.onArrival = () => {
      worker.showBubble(text, 4000);
      worker.showEmote("emote:thinking");
      worker.scene.time.delayedCall(8000, () => {
        worker.hideEmote();
        worker.onArrival = () => {
          worker.performing = false;
          worker.canWander = true;
          worker.scheduleWander();
        };
        worker.navigateHome();
      });
    };
  });
}

/**
 * 全员集合（站会/头脑风暴/团建/成果演示/全员开会）：所有人都走到中央空旷处围成一圈。
 */
function runAllHandsGather(workers: Worker[], text: string) {
  runAtSpotRound(GATHER_SPOT, workers, text);
}

/**
 * 所有参与者走到指定场景点围成一圈，到达后表演，停留后回工位。
 * 用于：圆桌研讨（洽谈区）、全员集合（中央）等需要"去某个位置"的多人动作。
 */
function runAtSpotRound(spot: { x: number; y: number }, workers: Worker[], text: string) {
  if (workers.length === 0) return;
  const count = workers.length;
  const radius = Math.min(26 + count * 4, 58);

  workers.forEach((worker, index) => {
    // 互动优先：中止当前任务、解除锁定，确保所有人都响应互动（发起人也去）
    if (worker.assignedRunId) {
      worker.abortTask(worker.assignedRunId);
      worker.assignedRunId = null;
    }
    worker.interactionLocked = false;
    worker.setStatus("idle");
    worker.stopIdleActivity();
    worker.canWander = false;
    worker.performing = true;
    worker.hideEmote();
    worker.bubble.hide();

    const angle = (index / Math.max(count, 1)) * Math.PI * 2 - Math.PI / 2;
    const tx = spot.x + Math.cos(angle) * radius;
    const ty = spot.y + Math.sin(angle) * radius;
    worker.navigateTo(tx, ty, { x: spot.x, y: spot.y });
    // 到达聚集点后表演，停留后回工位
    worker.onArrival = () => {
      worker.showBubble(text, 4000);
      worker.showEmote(index === 0 ? "emote:star" : "emote:thinking");
      worker.scene.time.delayedCall(8000, () => {
        worker.hideEmote();
        worker.onArrival = () => {
          worker.performing = false;
          worker.canWander = true;
          worker.scheduleWander();
        };
        worker.navigateHome();
      });
    };
  });
}

/**
 * Wires up all gameEvents listeners that bridge HUD/store actions into the Phaser scene.
 * Returns a cleanup function that unsubscribes all listeners.
 */
export function initSceneEventBridge(
  workerManager: WorkerManager,
  interactionManager: InteractionManager,
  setTerminalOpen: (open: boolean) => void,
): () => void {
  const unsubs: Array<() => void> = [];
  // 场景内部状态：session -> seat 绑定（由本桥自行持有）
  const sessionBindings = new Map<string, string>();

  unsubs.push(
    gameEvents.on("seat-configs-updated", (seats) => {
      workerManager.syncWorkers(seats, () => {});
    }),
  );

  unsubs.push(
    gameEvents.on("task-assigned", (taskId, message, seatId, sessionKey) => {
      // Route by explicit seatId, or by session binding (session -> character), or find idle worker
      const boundSeatId = sessionKey ? sessionBindings.get(sessionKey) : undefined;
      const targetSeatId = seatId ?? boundSeatId;
      const worker = workerManager.findBySeatId(targetSeatId) ?? workerManager.findIdle();
      if (!worker) {
        gameEvents.emit("task-ready", taskId, message, seatId);
        return;
      }
      // Bind session to character when character gets the task
      if (sessionKey) sessionBindings.set(sessionKey, worker.seatId);
      gameEvents.emit("task-routed", taskId, worker.seatId, worker.label);
      // When routed to this worker (explicit seat or session-bound) and they're busy: queue on worker
      if (worker.status === "working" && worker.assignedRunId) {
        gameEvents.emit("task-staged", taskId, "queued", worker.seatId);
        worker.enqueueTask(taskId, message, () =>
          gameEvents.emit("task-ready", taskId, message, worker.seatId),
        );
        workerManager.runWorkerMap.set(taskId, worker);
        return;
      }

      if (worker.isAwayFromDesk()) {
        gameEvents.emit("task-staged", taskId, "returning", worker.seatId);
      }

      const ready = () => gameEvents.emit("task-ready", taskId, message, worker.seatId);
      worker.assignTask(taskId, message, ready);
      workerManager.runWorkerMap.set(taskId, worker);
    }),
  );

  unsubs.push(
    gameEvents.on("task-bound", (taskId, runId) => {
      const worker = workerManager.runWorkerMap.get(taskId);
      if (!worker) return;
      worker.rebindAssignedRun(taskId, runId);
      workerManager.runWorkerMap.delete(taskId);
      workerManager.runWorkerMap.set(runId, worker);
    }),
  );

  unsubs.push(
    gameEvents.on("task-bubble", (runId, text, ttl) => {
      const worker = workerManager.runWorkerMap.get(runId);
      if (worker) worker.showBubble(text, ttl ?? 5000);
    }),
  );

  unsubs.push(
    gameEvents.on("task-completed", (runId) => {
      const worker = workerManager.runWorkerMap.get(runId);
      if (worker) {
        worker.completeTask();
        workerManager.runWorkerMap.delete(runId);
      }
    }),
  );

  unsubs.push(
    gameEvents.on("task-failed", (runId) => {
      const worker = workerManager.runWorkerMap.get(runId);
      if (worker) {
        worker.failTask();
        workerManager.runWorkerMap.delete(runId);
      }
    }),
  );

  unsubs.push(
    gameEvents.on("task-aborted", (runId) => {
      const worker = workerManager.runWorkerMap.get(runId);
      if (!worker) return;
      if (worker.abortTask(runId)) {
        workerManager.runWorkerMap.delete(runId);
      }
    }),
  );

  unsubs.push(
    gameEvents.on("subagent-assigned", (runId, _parentRunId, label, seatId?) => {
      const worker = seatId
        ? (workerManager.findBySeatId(seatId) ?? workerManager.findIdle())
        : workerManager.findIdle();
      if (!worker) return;
      worker.assignTask(runId, `[Sub] ${label}`);
      workerManager.runWorkerMap.set(runId, worker);
    }),
  );

  unsubs.push(
    gameEvents.on("office-activity", ({ mode, actorSeatId, targetSeatIds }) => {
      const allWorkers = workerManager.workers;
      // 防御性回退：actor 找不到时兜底到第一个 worker，避免事件静默丢失
      const actor =
        workerManager.findBySeatId(actorSeatId) ?? allWorkers[0] ?? null;
      const targets =
        mode === "allHands"
          ? allWorkers
          : uniqueWorkers([
              actor,
              ...targetSeatIds.map((seatId) => workerManager.findBySeatId(seatId)),
            ]);

      if (targets.length === 0) {
        console.warn("office-activity ignored: no target workers", {
          mode,
          actorSeatId,
          targetSeatIds,
          workerSeatIds: allWorkers.map((worker) => worker.seatId),
        });
        return;
      }

      if (mode === "focus") {
        // 专注工作：留在工位（合理场景）
        targets.forEach((worker) => runDeskActivity(worker, "emote:device", "专注处理当前任务"));
        return;
      }
      if (mode === "thinking") {
        // 思考方案：留在工位
        targets.forEach((worker) => runDeskActivity(worker, "emote:thinking", "梳理方案和风险"));
        return;
      }
      if (mode === "music") {
        // 听歌工作：留在工位
        targets.forEach((worker) => runDeskActivity(worker, "emote:music", "听歌保持节奏"));
        return;
      }
      if (mode === "drink") {
        // 喝水：走到茶水区饮水机1（避免和负责人工位区混淆）
        targets.forEach((worker) => runSceneActivity(worker, "water", "emote:heart", "到饮水机接杯水"));
        return;
      }
      if (mode === "rest") {
        // 右侧小坐/复盘：分散到右侧多张桌椅（不挤同一张，沙发留给 AI）
        runRightSeats(targets, "到右侧复盘区小坐");
        return;
      }
      if (mode === "exercise") {
        // 起身锻炼：走到空旷走道
        targets.forEach((worker) => runSceneActivity(worker, "openArea", "emote:star", "到空地活动活动"));
        return;
      }
      if (mode === "game") {
        // 摸鱼游戏：到右侧桌椅区（不占沙发）
        targets.forEach((worker) => runSceneActivity(worker, "rightSeat", "emote:music", "到右侧摸鱼放松一下"));
        return;
      }
      if (mode === "read") {
        // 翻阅资料：走到书架
        targets.forEach((worker) => runSceneActivity(worker, "bookshelf", "emote:thinking", "到书架查阅资料"));
        return;
      }
      if (mode === "coffee") {
        // 冲咖啡：走到茶水区饮水机1
        targets.forEach((worker) => runSceneActivity(worker, "water", "emote:heart", "去冲杯咖啡"));
        return;
      }
      if (mode === "chat") {
        runGroupActivity(targets, "闲聊沟通中");
        return;
      }
      if (mode === "delegate") {
        runGroupActivity(targets, "安排工作任务");
        return;
      }
      if (mode === "review") {
        runGroupActivity(targets, "进度评审中");
        return;
      }
      if (mode === "kpi") {
        runGroupActivity(targets, "绩效沟通中");
        return;
      }
      if (mode === "negotiate") {
        // 洽谈沟通：成员两两结对原地沟通
        runGroupActivity(targets, "洽谈沟通中");
        return;
      }
      if (mode === "copy" || mode === "print") {
        // 复印/打印：走到打印机
        targets.forEach((worker) => runSceneActivity(worker, "printer", "emote:thinking", "到打印机旁整理资料"));
        return;
      }
      if (mode === "water") {
        targets.forEach((worker) => runSceneActivity(worker, "water", "emote:heart", "去接杯水"));
        return;
      }
      if (mode === "standup") {
        // 站会：全员到中央空地集合
        runAllHandsGather(targets, "站会同步中");
        return;
      }
      if (mode === "brainstorm") {
        // 头脑风暴：全员到白板前集合
        runAllHandsGather(targets, "到白板前头脑风暴");
        return;
      }
      if (mode === "demo") {
        // 成果演示：全员集合（发起人演示）
        runAllHandsGather(targets, "成果演示中");
        return;
      }
      if (mode === "lunch") {
        // 午间用餐：分散到右侧餐桌区
        runRightSeats(targets, "到餐桌一起吃个饭");
        return;
      }
      if (mode === "plant") {
        // 打理绿植：到工作台附近
        targets.forEach((worker) => runSceneActivity(worker, "workbench", "emote:star", "打理绿植"));
        return;
      }
      if (mode === "stretch") {
        // 舒展拉伸：到空旷走道
        targets.forEach((worker) => runSceneActivity(worker, "openArea", "emote:star", "到空地舒展拉伸"));
        return;
      }
      if (mode === "focus_group") {
        runGroupActivity(targets, "小组讨论中");
        return;
      }
      if (mode === "handover") {
        runGroupActivity(targets, "交接工作中");
        return;
      }
      if (mode === "teambuild") {
        // 团建：全员到中央空地集合
        runAllHandsGather(targets, "团建小游戏");
        return;
      }
      if (mode === "book_read") {
        // 图书角阅读：走到右侧书架
        targets.forEach((worker) => runSceneActivity(worker, "bookshelf3", "emote:thinking", "到图书角翻阅资料"));
        return;
      }
      if (mode === "roundtable") {
        // 白板前复盘：全员到白板前围圈（空间大，替代原小洽谈区的圆桌研讨）
        runAtSpotRound(SCENE_SPOTS.whiteboard, targets, "白板前复盘");
        return;
      }
      if (mode === "device_check") {
        // 设备调试：走到右侧工作台
        targets.forEach((worker) => runSceneActivity(worker, "workbench", "emote:wrench", "到工作台调试设备"));
        return;
      }
      if (mode === "walk") {
        // 走廊踱步：走到右侧走道
        targets.forEach((worker) => runSceneActivity(worker, "corridor", "emote:thinking", "到右侧走廊走走理思路"));
        return;
      }
      if (mode === "oneToOne") {
        runGroupActivity(targets, "对齐任务细节");
        return;
      }
      if (mode === "group") {
        runGroupActivity(targets, "小组沟通中");
        return;
      }
      if (mode === "allHands") {
        runAllHandsGather(allWorkers, "全员同步当前进展");
      }
    }),
  );

  unsubs.push(
    gameEvents.on("terminal-closed", () => {
      setTerminalOpen(false);
    }),
  );

  return () => {
    for (const unsub of unsubs) unsub();
  };
}

