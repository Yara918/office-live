import * as Phaser from "phaser";
import { InteractionMenu, type MenuOption } from "../entities/InteractionMenu";
import { Worker } from "../entities/Worker";
import { gameEvents } from "@/lib/events";
import type { WorkerManager } from "./WorkerManager";
import { OFFICE_CONFIG } from "@/lib/office-config";
import { isAdminUnlocked } from "@/lib/admin-gate";

export class InteractionManager {
  private scene: Phaser.Scene;
  private workerManager: WorkerManager;

  interactionMenu!: InteractionMenu;
  menuOpen = false;

  constructor(scene: Phaser.Scene, workerManager: WorkerManager) {
    this.scene = scene;
    this.workerManager = workerManager;
  }

  initInteractionUI() {
    this.interactionMenu = new InteractionMenu(this.scene);
    this.interactionMenu.onClose = () => {
      this.menuOpen = false;
    };

    // 点击任意成员：负责人直接打开任务面板；其他成员直接打开人员档案
    this.scene.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (pointer.button !== 0) return;
      if (this.menuOpen) {
        this.menuOpen = false;
        this.interactionMenu.hide();
        return;
      }
      const world = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const worker = this.workerManager.findNearestAt(world.x, world.y);
      if (worker) {
        if (worker.isOwner) {
          // 负责人：已解锁 → 打开任务面板；未解锁 → 弹出管理员验证（员工点负责人也只能看/验证）
          if (isAdminUnlocked()) {
            gameEvents.emit("open-terminal", worker.seatId);
          } else {
            gameEvents.emit("request-admin");
          }
        } else {
          // 普通成员：点击 → 直接打开人员档案（工作概况），没有任何管理入口
          gameEvents.emit("open-person-detail", worker.seatId);
        }
      }
    });
  }

  /** 负责人常驻 E 标识：每帧由场景调用（确保 E 跟随负责人 Worker） */
  updateOwnerIndicator(_workerManager: WorkerManager) {
    const owner = _workerManager.findOwner();
    if (owner) owner.updateOwnerIndicator();
  }

  openWorkerMenu(worker: Worker) {
    this.menuOpen = true;

    const isWorking = worker.status === "working";
    const isOwner = worker.isOwner;

    const options: MenuOption[] = [
      {
        label: "工作概况",
        enabled: true,
        action: () => {
          this.menuOpen = false;
          this.interactionMenu.hide();
          gameEvents.emit("open-person-detail", worker.seatId);
        },
      },
      {
        label: "查看记录",
        enabled: true,
        action: () => {
          this.menuOpen = false;
          this.interactionMenu.hide();
          gameEvents.emit("open-session-history", worker.seatId);
        },
      },
    ];

    // 只有表格维护人（负责人）才有改表格的操作入口
    if (isOwner) {
      options.push(
        {
          label: "任务面板",
          enabled: true,
          action: () => {
            this.menuOpen = false;
            this.interactionMenu.hide();
            gameEvents.emit("open-terminal", worker.seatId);
          },
        },
        {
          label: "安排任务",
          enabled: true,
          action: () => {
            this.menuOpen = false;
            this.interactionMenu.hide();
            if (worker.status === "idle" || worker.status === "done") {
              gameEvents.emit("open-terminal", worker.seatId);
            } else {
              gameEvents.emit("open-terminal-queue", worker.seatId);
            }
          },
        },
        {
          label: "调整负责人",
          enabled: true,
          action: () => {
            this.menuOpen = false;
            this.interactionMenu.hide();
            gameEvents.emit("open-reassign-panel", worker.seatId);
          },
        },
      );
    }

    options.push({
      label: "停止任务",
      enabled: isWorking,
      action: () => {
        this.menuOpen = false;
        this.interactionMenu.hide();
        if (worker.assignedRunId) {
          gameEvents.emit("stop-task", worker.assignedRunId, worker.seatId);
        }
      },
    });

    options.push({
      label: "取消",
      enabled: true,
      action: () => {
        this.menuOpen = false;
        this.interactionMenu.hide();
      },
    });

    if (worker.taskQueue.length > 0) {
      options.splice(3, 0, {
        label: `排队中 (${worker.taskQueue.length})`,
        enabled: false,
        action: () => {},
      });
    }

    this.interactionMenu.show(worker.sprite.x, worker.sprite.y, options);
  }

  destroy() {
    this.interactionMenu?.destroy();
  }
}
