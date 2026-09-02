import * as Phaser from "phaser";
import { FRAME_HEIGHT, makeAnims, type Direction } from "../config/animations";
import { EMOTE_SHEET_KEY, EMOTE_ANIMS } from "../config/emotes";
import { ChatBubble } from "./ChatBubble";
import type { Pathfinder, PathPoint } from "../utils/Pathfinder";
import { buildSpriteFrames } from "../utils/MapHelpers";
import {
  WANDER_INITIAL_MIN,
  WANDER_INITIAL_MAX,
  EMOTE_Y_OFFSET,
  BUBBLE_Y_OFFSET,
} from "@/lib/constants";
import { getCurrentOfficeSnapshot } from "@/lib/office-sync";
import { isTaskDone, taskOwnedBy } from "@/lib/office-data";

// Sub-modules
import type { WorkerCtx, WorkerStatus, QueuedTask, POI } from "./worker/types";
import {
  BODY_WIDTH,
  BODY_HEIGHT,
  BODY_OFFSET_X,
  BODY_OFFSET_Y,
  updateMovement,
  navigateTo as movNavigateTo,
  navigateHome as movNavigateHome,
  isAtHomePose as movIsAtHomePose,
} from "./worker/movement";
import {
  resetWanderClock,
  scheduleWander as idleScheduleWander,
  stopIdleActivity as idleStopIdleActivity,
} from "./worker/idle";
import {
  assignTask as taskAssignTask,
  completeTask as taskCompleteTask,
  failTask as taskFailTask,
  abortTask as taskAbortTask,
  enqueueTask as taskEnqueueTask,
} from "./worker/task";

export { resetWanderClock };
export type { WorkerStatus, POI };

export class Worker implements WorkerCtx {
  sprite: Phaser.Physics.Arcade.Sprite;
  bubble: ChatBubble;
  readonly seatId: string;
  readonly label: string;
  readonly spriteKey: string;
  readonly homeX: number;
  readonly homeY: number;
  readonly scene: Phaser.Scene;
  readonly initialFacing: Direction;

  // Movement state (exposed for sub-modules via WorkerCtx)
  facing: Direction;
  moveTarget: { x: number; y: number } | null = null;
  currentPath: PathPoint[] = [];
  pathIndex = 0;
  isReturningHome = false;
  faceTarget: { x: number; y: number } | null = null;
  arrivalFacing: Direction | null = null;
  onArrival: (() => void) | null = null;
  stuckFrames = 0;
  lastX = 0;
  lastY = 0;
  pathfinder: Pathfinder | null = null;

  // Idle / wander state
  canWander = true;
  isWandering = false;
  pois: POI[] = [];
  wanderTimer: Phaser.Time.TimerEvent | null = null;
  activityTimer: Phaser.Time.TimerEvent | null = null;
  interactionLocked = false;
  /** 表演中标记：原地/走动表演期间为 true，防止"卡住自愈"误判打断 */
  performing = false;

  // Task state
  _status: WorkerStatus = "idle";
  assignedRunId: string | null = null;
  currentTaskMessage: string | null = null;
  taskQueue: QueuedTask[] = [];
  taskVisualTimer: Phaser.Time.TimerEvent | null = null;

  // Internal
  private nameTag: Phaser.GameObjects.Text;
  private taskStatusText: Phaser.GameObjects.Text;
  private statusDot: Phaser.GameObjects.Arc;
  private emoteSprite: Phaser.GameObjects.Sprite | null = null;
  private currentEmoteKey: string | null = null;
  private initTimer: Phaser.Time.TimerEvent | null = null;
  private paused = false;
  private savedVx = 0;
  private savedVy = 0;

  /** 是否表格维护人（负责人）：头顶常驻 E 标识，点击可打开任务面板 */
  isOwner = false;
  /** 负责人头顶的常驻 E 标识 */
  private ownerIndicator: Phaser.GameObjects.Text | null = null;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    spriteKey: string,
    seatId: string,
    label: string,
    facing: Direction = "up",
  ) {
    this.scene = scene;
    this.seatId = seatId;
    this.label = label;
    this.spriteKey = spriteKey;
    this.facing = facing;
    this.initialFacing = facing;
    this.homeX = x;
    this.homeY = y;

    this.ensureAnims(scene, spriteKey);

    this.sprite = scene.physics.add.sprite(x, y, spriteKey, 0);
    this.sprite.setDepth(5);
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.setSize(BODY_WIDTH, BODY_HEIGHT);
    body.setOffset(BODY_OFFSET_X, BODY_OFFSET_Y);
    body.allowGravity = false;
    body.pushable = false;
    body.mass = 999;

    this.sprite.anims.play(`${spriteKey}:idle-${facing}`);

    const snapshot = getCurrentOfficeSnapshot();
    // 直接按任务统计状态，不依赖成员档案（新人有任务但还没加入人员表也能正确显示）
    const memberTasks = snapshot.tasks.filter((task) => taskOwnedBy(task, label));
    const overdueTasks = memberTasks.filter((task) => task.overdue);
    const _dist = new Map<string, number>();
    for (const _t of memberTasks) {
      const _v = _t.status.trim();
      if (_v) _dist.set(_v, (_dist.get(_v) || 0) + 1);
    }
    const _top = [..._dist.entries()].sort((a, b) => b[1] - a[1])[0];
    const initialStatus =
      overdueTasks.length > 0
        ? `需关注 ${overdueTasks.length}`
        : memberTasks.length > 0
          ? `${_top ? _top[0] : "任务"} ${memberTasks.length}`
          : "待命";
    const nameY = y - FRAME_HEIGHT * 0.58;
    this.nameTag = scene.add
      .text(x, nameY, label, {
        fontFamily: '"Microsoft YaHei", "PingFang SC", Arial, sans-serif',
        fontSize: "12px",
        fontStyle: "bold",
        color: "#ffffff",
        backgroundColor:
          overdueTasks.length > 0 ? "rgba(185, 28, 28, 0.88)" : "rgba(15, 23, 42, 0.86)",
        padding: { x: 7, y: 3 },
        align: "center",
      })
      .setOrigin(0.5, 1)
      .setDepth(20);

    this.statusDot = scene.add.circle(
      x + this.nameTag.width / 2 + 8,
      nameY - this.nameTag.height / 2,
      4,
      overdueTasks.length > 0 ? 0xef4444 : memberTasks.length > 0 ? 0xfacc15 : 0x22c55e,
    );
    this.statusDot.setDepth(20);

    this.taskStatusText = scene.add
      .text(x, nameY + 4, `成员 · ${initialStatus}`, {
        fontFamily: '"Microsoft YaHei", "PingFang SC", Arial, sans-serif',
        fontSize: "10px",
        color: overdueTasks.length > 0 ? "#fecaca" : "#dbeafe",
        backgroundColor: "rgba(15, 23, 42, 0.82)",
        padding: { x: 6, y: 2 },
        align: "center",
      })
      .setOrigin(0.5, 0)
      .setDepth(20)
      .setVisible(true);

    this.bubble = new ChatBubble(scene);
    this.initEmoteSprite();

    const initialDelay = Phaser.Math.Between(WANDER_INITIAL_MIN, WANDER_INITIAL_MAX);
    this.initTimer = scene.time.delayedCall(initialDelay, () => {
      this.initTimer = null;
      this.scheduleWander();
    });
  }

  /**
   * 标记为表格维护人（负责人）：头顶常驻金色「E · 任务面板」标识。
   * 由 OfficeRosterSync / WorkerManager 根据配置 ownerName 调用。
   */
  setOwner(isOwner: boolean) {
    this.isOwner = isOwner;
    if (isOwner && !this.ownerIndicator) {
      this.ownerIndicator = this.scene.add
        .text(this.sprite.x, this.sprite.y - FRAME_HEIGHT * 0.85, "E · 任务面板", {
          fontFamily: '"SF Mono", "Cascadia Code", Consolas, monospace',
          fontSize: "14px",
          fontStyle: "bold",
          color: "#c9a227",
          backgroundColor: "rgba(37, 34, 25, 0.92)",
          padding: { x: 7, y: 3 },
          align: "center",
        })
        .setOrigin(0.5, 1)
        .setDepth(21);
      // 轻微上下浮动
      this.scene.tweens.add({
        targets: this.ownerIndicator,
        y: this.sprite.y - FRAME_HEIGHT * 0.95,
        duration: 900,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    } else if (!isOwner && this.ownerIndicator) {
      this.ownerIndicator.destroy();
      this.ownerIndicator = null;
    }
  }

  /** 每帧跟随负责人位置（在 update 中调用） */
  updateOwnerIndicator() {
    if (!this.ownerIndicator) return;
    this.ownerIndicator.setX(this.sprite.x);
    this.ownerIndicator.setY(this.sprite.y - FRAME_HEIGHT * 0.9);
  }

  // 鈹€鈹€ Emote system 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

  private initEmoteSprite() {
    if (!this.scene.textures.exists(EMOTE_SHEET_KEY)) return;

    this.emoteSprite = this.scene.add.sprite(
      this.sprite.x,
      this.sprite.y - FRAME_HEIGHT * EMOTE_Y_OFFSET,
      EMOTE_SHEET_KEY,
      0,
    );
    this.emoteSprite.setDepth(22);
    this.emoteSprite.setVisible(false);

    this.registerEmoteAnims();
  }

  private registerEmoteAnims() {
    for (const def of EMOTE_ANIMS) {
      if (this.scene.anims.exists(def.key)) continue;
      const frames = def.frames.map((f) => ({ key: EMOTE_SHEET_KEY, frame: f }));
      this.scene.anims.create({
        key: def.key,
        frames,
        frameRate: def.frameRate,
        repeat: def.repeat,
      });
    }
  }

  showEmote(emoteKey: string) {
    if (!this.emoteSprite) return;
    if (this.currentEmoteKey === emoteKey) return;

    this.bubble.hide();
    this.emoteSprite.removeAllListeners("animationcomplete");

    this.currentEmoteKey = emoteKey;
    this.emoteSprite.setVisible(true);
    this.emoteSprite.play(emoteKey);

    const anim = EMOTE_ANIMS.find((a) => a.key === emoteKey);
    if (anim && anim.repeat >= 0) {
      this.emoteSprite.once("animationcomplete", () => {
        if (!this.emoteSprite) return;
        this.emoteSprite.setVisible(false);
        this.currentEmoteKey = null;
      });
    }
  }

  hideEmote() {
    if (!this.emoteSprite) return;
    this.emoteSprite.removeAllListeners("animationcomplete");
    this.emoteSprite.setVisible(false);
    this.emoteSprite.stop();
    this.currentEmoteKey = null;
  }

  // 鈹€鈹€ Animation registration 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

  private ensureAnims(scene: Phaser.Scene, spriteKey: string) {
    if (scene.anims.exists(`${spriteKey}:idle-down`)) return;

    buildSpriteFrames(scene, spriteKey);

    const idleAnims = makeAnims(spriteKey, "idle", 1, 8);
    const walkAnims = makeAnims(spriteKey, "walk", 2, 10);
    for (const anim of [...idleAnims, ...walkAnims]) {
      const frames: Phaser.Types.Animations.AnimationFrame[] = [];
      for (let i = anim.start; i <= anim.end; i++) {
        frames.push({ key: spriteKey, frame: i });
      }
      scene.anims.create({
        key: anim.key,
        frames,
        frameRate: anim.frameRate,
        repeat: anim.repeat,
      });
    }
  }

  // 鈹€鈹€ Status 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

  get status(): WorkerStatus {
    return this._status;
  }

  setStatus(status: WorkerStatus) {
    this._status = status;
    const colors: Record<WorkerStatus, number> = {
      idle: 0x888888,
      working: 0xfacc15,
      done: 0x22c55e,
      failed: 0xef4444,
    };
    this.statusDot.setFillStyle(colors[status]);

    if (status === "idle") {
      this.canWander = true;
      this.scheduleWander();
    } else if (status === "working") {
      this.stopIdleActivity();
      this.canWander = false;
    } else {
      this.canWander = false;
    }
  }

  // 鈹€鈹€ Delegated: Movement 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

  navigateTo(x: number, y: number, facePoi?: { x: number; y: number }) {
    movNavigateTo(this, x, y, facePoi);
  }

  navigateHome() {
    movNavigateHome(this);
  }

  isAtHomePose() {
    return movIsAtHomePose(this);
  }

  // 鈹€鈹€ Delegated: Task management 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

  assignTask(runId: string, taskMessage: string, onReady?: () => void) {
    taskAssignTask(this, runId, taskMessage, onReady);
  }

  completeTask() {
    taskCompleteTask(this);
  }

  failTask() {
    taskFailTask(this);
  }

  abortTask(runId: string) {
    return taskAbortTask(this, runId);
  }

  enqueueTask(runId: string, message: string, onReady?: () => void) {
    taskEnqueueTask(this, runId, message, onReady);
  }

  // 鈹€鈹€ Delegated: Idle behavior 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

  stopIdleActivity() {
    idleStopIdleActivity(this);
  }

  scheduleWander() {
    idleScheduleWander(this);
  }

  // 鈹€鈹€ Bubble 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

  showBubble(message: string, ttl = 5000) {
    this.hideEmote();
    const bubbleX = this.sprite.x;
    const bubbleY = this.sprite.y - FRAME_HEIGHT * BUBBLE_Y_OFFSET;
    this.bubble.show(message, bubbleX, bubbleY, ttl);
  }

  // 鈹€鈹€ Public helpers 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

  setPOIs(pois: POI[]) {
    this.pois = pois;
  }

  setPathfinder(pf: Pathfinder) {
    this.pathfinder = pf;
  }

  canInteract() {
    return !this.interactionLocked;
  }

  isAwayFromDesk() {
    return this.moveTarget !== null || this.isWandering || !this.isAtHomePose();
  }

  rebindAssignedRun(previousRunId: string, nextRunId: string) {
    if (this.assignedRunId === previousRunId) {
      this.assignedRunId = nextRunId;
    }
  }

  // 鈹€鈹€ Pause / Resume (boss proximity) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

  pause() {
    if (this.paused) return;
    this.paused = true;
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    this.savedVx = body.velocity.x;
    this.savedVy = body.velocity.y;
    body.setVelocity(0, 0);

    const idleKey = `${this.spriteKey}:idle-${this.facing}`;
    if (this.sprite.anims.currentAnim?.key !== idleKey) {
      this.sprite.anims.play(idleKey);
    }
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    if (this.moveTarget) {
      const body = this.sprite.body as Phaser.Physics.Arcade.Body;
      body.setVelocity(this.savedVx, this.savedVy);
    }
  }

  // 鈹€鈹€ Update (call from scene.update) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

  update() {
    if (!this.paused) updateMovement(this);

    // 卡住自愈：互动/表演流程若因异常中断（timer 或 onArrival 丢失），
    // 且状态是空闲但 canWander=false、无任何移动目标/定时器、非表演中，则强制恢复游荡，
    // 避免成员"永久站住不动"（时好时坏的问题根源）
    if (!this.paused && !this.canWander && this._status === "idle" && !this.performing) {
      const hasActivity =
        this.moveTarget !== null ||
        this.wanderTimer !== null ||
        this.activityTimer !== null ||
        this.onArrival !== null ||
        this.isWandering;
      if (!hasActivity) {
        this.canWander = true;
        this.scheduleWander();
      }
    }

    const snapshot = getCurrentOfficeSnapshot();
    // 直接按任务统计状态，不依赖成员档案（新人有任务但还没加入人员表也能正确显示）
    const memberTasks = snapshot.tasks.filter((task) => taskOwnedBy(task, this.label));
    const overdueTasks = memberTasks.filter((task) => task.overdue);
    const _dist = new Map<string, number>();
    for (const _t of memberTasks) {
      const _v = _t.status.trim();
      if (_v) _dist.set(_v, (_dist.get(_v) || 0) + 1);
    }
    const _top = [..._dist.entries()].sort((a, b) => b[1] - a[1])[0];
    const nameY = this.sprite.y - FRAME_HEIGHT * 0.58;
    this.nameTag.setPosition(this.sprite.x, nameY);
    this.statusDot.setPosition(
      this.sprite.x + this.nameTag.width / 2 + 8,
      nameY - this.nameTag.height / 2,
    );

    const hasTask = this.assignedRunId || this.taskQueue.length > 0;
    if (this.taskStatusText) {
      this.taskStatusText.setPosition(this.sprite.x, nameY + 4);
      if (hasTask) {
        const parts: string[] = [];
        if (this.currentTaskMessage) {
          const snip =
            this.currentTaskMessage.length > 14
              ? `${this.currentTaskMessage.slice(0, 14)}...`
              : this.currentTaskMessage;
          parts.push(`处理中：${snip}`);
        }
        if (this.taskQueue.length > 0) {
          parts.push(`排队 ${this.taskQueue.length}`);
        }
        this.taskStatusText.setText(parts.join(" | "));
        this.taskStatusText.setVisible(true);
      } else {
        const status =
          overdueTasks.length > 0
            ? `需关注 ${overdueTasks.length}`
            : memberTasks.length > 0
              ? `${_top ? _top[0] : "任务"} ${memberTasks.length}`
              : "待命";
        this.taskStatusText.setText(`成员 · ${status}`);
        this.taskStatusText.setVisible(true);
      }
    }

    if (this.emoteSprite) {
      this.emoteSprite.setPosition(this.sprite.x, this.sprite.y - FRAME_HEIGHT * EMOTE_Y_OFFSET);
    }

    if (this.bubble) {
      this.bubble.updatePosition(this.sprite.x, this.sprite.y - FRAME_HEIGHT * BUBBLE_Y_OFFSET);
    }

    this.updateOwnerIndicator();
  }

  // 鈹€鈹€ Cleanup 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

  destroy() {
    if (this.initTimer) {
      this.initTimer.destroy();
      this.initTimer = null;
    }
    if (this.ownerIndicator) {
      this.ownerIndicator.destroy();
      this.ownerIndicator = null;
    }
    this.interactionLocked = false;
    this.stopIdleActivity();
    if (this.taskVisualTimer) {
      this.taskVisualTimer.destroy();
      this.taskVisualTimer = null;
    }
    if (this.emoteSprite) {
      this.emoteSprite.removeAllListeners();
      this.emoteSprite.destroy();
      this.emoteSprite = null;
    }
    this.sprite.destroy();
    this.nameTag.destroy();
    this.taskStatusText.destroy();
    this.statusDot.destroy();
    this.bubble.destroy();
    this.pathfinder = null;
    this.onArrival = null;
  }
}

