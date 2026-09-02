import * as Phaser from "phaser";
import { FRAME_WIDTH, FRAME_HEIGHT, MOVE_SPEED } from "../../config/animations";
import {
  ARRIVE_THRESHOLD,
  WORKER_SPEED_FACTOR,
  STUCK_FRAME_LIMIT,
  STUCK_MOVE_THRESHOLD,
  BODY_SIZE_RATIO_W,
  BODY_SIZE_RATIO_H,
  BODY_OFFSET_RATIO_X,
  BODY_OFFSET_RATIO_Y,
} from "@/lib/constants";
import type { WorkerCtx } from "./types";

const WORKER_SPEED = MOVE_SPEED * WORKER_SPEED_FACTOR;
export const BODY_WIDTH = FRAME_WIDTH * BODY_SIZE_RATIO_W;
export const BODY_HEIGHT = FRAME_HEIGHT * BODY_SIZE_RATIO_H;
export const BODY_OFFSET_X = FRAME_WIDTH * BODY_OFFSET_RATIO_X;
export const BODY_OFFSET_Y = FRAME_HEIGHT * BODY_OFFSET_RATIO_Y;
const HOME_NAV_OFFSET_X = BODY_OFFSET_X + BODY_WIDTH / 2 - FRAME_WIDTH / 2;
const HOME_NAV_OFFSET_Y = BODY_OFFSET_Y + BODY_HEIGHT / 2 - FRAME_HEIGHT / 2;

export function navPoint(ctx: WorkerCtx) {
  const body = ctx.sprite.body as Phaser.Physics.Arcade.Body;
  return { x: body.center.x, y: body.center.y };
}

export function homeNavPoint(ctx: WorkerCtx) {
  return {
    x: ctx.homeX + HOME_NAV_OFFSET_X,
    y: ctx.homeY + HOME_NAV_OFFSET_Y,
  };
}

export function isAtHomePose(ctx: WorkerCtx) {
  return Phaser.Math.Distance.Between(ctx.sprite.x, ctx.sprite.y, ctx.homeX, ctx.homeY) <= 2;
}

export function faceToward(ctx: WorkerCtx, tx: number, ty: number) {
  const nav = navPoint(ctx);
  const dx = tx - nav.x;
  const dy = ty - nav.y;
  if (Math.abs(dx) > Math.abs(dy)) {
    ctx.facing = dx > 0 ? "right" : "left";
  } else {
    ctx.facing = dy > 0 ? "down" : "up";
  }
}

export function resetToHomePose(ctx: WorkerCtx) {
  const body = ctx.sprite.body as Phaser.Physics.Arcade.Body;
  ctx.sprite.setPosition(ctx.homeX, ctx.homeY);
  body.reset(ctx.homeX, ctx.homeY);
  ctx.facing = ctx.initialFacing;
}

function arriveAndStop(ctx: WorkerCtx) {
  const body = ctx.sprite.body as Phaser.Physics.Arcade.Body;
  body.setVelocity(0, 0);
  ctx.moveTarget = null;
  ctx.currentPath = [];
  ctx.pathIndex = 0;
  const returningHome = ctx.isReturningHome;
  ctx.isReturningHome = false;
  ctx.stuckFrames = 0;

  if (returningHome) {
    resetToHomePose(ctx);
    ctx.faceTarget = null;
    ctx.arrivalFacing = null;
  } else if (ctx.arrivalFacing) {
    ctx.facing = ctx.arrivalFacing;
    ctx.arrivalFacing = null;
    ctx.faceTarget = null;
  } else if (ctx.faceTarget) {
    faceToward(ctx, ctx.faceTarget.x, ctx.faceTarget.y);
    ctx.faceTarget = null;
  }

  const idleKey = `${ctx.spriteKey}:idle-${ctx.facing}`;
  if (ctx.sprite.anims.currentAnim?.key !== idleKey) {
    ctx.sprite.anims.play(idleKey);
  }

  if (ctx.onArrival) {
    const cb = ctx.onArrival;
    ctx.onArrival = null;
    cb();
  }
}

export function updateMovement(ctx: WorkerCtx) {
  if (!ctx.moveTarget) return;

  const nav = navPoint(ctx);
  const dx = ctx.moveTarget.x - nav.x;
  const dy = ctx.moveTarget.y - nav.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < ARRIVE_THRESHOLD) {
    if (ctx.currentPath.length > 0 && ctx.pathIndex < ctx.currentPath.length - 1) {
      ctx.pathIndex++;
      ctx.moveTarget = ctx.currentPath[ctx.pathIndex];
      ctx.stuckFrames = 0;
      return;
    }
    arriveAndStop(ctx);
    return;
  }

  const movedX = Math.abs(nav.x - ctx.lastX);
  const movedY = Math.abs(nav.y - ctx.lastY);
  if (movedX < STUCK_MOVE_THRESHOLD && movedY < STUCK_MOVE_THRESHOLD) {
    ctx.stuckFrames++;
  } else {
    ctx.stuckFrames = 0;
  }
  ctx.lastX = nav.x;
  ctx.lastY = nav.y;

  if (ctx.stuckFrames > STUCK_FRAME_LIMIT) {
    ctx.stuckFrames = 0;
    if (ctx.currentPath.length > 0 && ctx.pathIndex < ctx.currentPath.length - 1) {
      ctx.pathIndex++;
      ctx.moveTarget = ctx.currentPath[ctx.pathIndex];
      return;
    }
    arriveAndStop(ctx);
    return;
  }

  const vx = (dx / dist) * WORKER_SPEED;
  const vy = (dy / dist) * WORKER_SPEED;
  (ctx.sprite.body as Phaser.Physics.Arcade.Body).setVelocity(vx, vy);

  faceToward(ctx, ctx.moveTarget.x, ctx.moveTarget.y);

  const walkKey = `${ctx.spriteKey}:walk-${ctx.facing}`;
  if (ctx.sprite.anims.currentAnim?.key !== walkKey) {
    ctx.sprite.anims.play(walkKey);
  }
}

export function navigateTo(
  ctx: WorkerCtx,
  x: number,
  y: number,
  facePoi?: { x: number; y: number },
) {
  ctx.faceTarget = facePoi ?? null;
  if (ctx.pathfinder) {
    const start = navPoint(ctx);
    const path = ctx.pathfinder.findPath(start.x, start.y, x, y);
    if (path && path.length > 1) {
      ctx.currentPath = path;
      ctx.pathIndex = 1;
      ctx.moveTarget = ctx.currentPath[1];
      return;
    }
  }
  // 寻路失败：原地不动（绝不直线穿墙）；不触发 onArrival，避免误判到达
  ctx.currentPath = [];
  ctx.pathIndex = 0;
  ctx.moveTarget = null;
  ctx.faceTarget = null;
  // 兜底：不永久卡住——若已有到达回调（互动表演/回工位），原地触发完成流程；
  // 否则若在闲逛中，恢复游荡调度
  if (ctx.onArrival) {
    const cb = ctx.onArrival;
    ctx.onArrival = null;
    ctx.scene.time.delayedCall(0, () => cb());
  } else if (ctx.isWandering) {
    ctx.isWandering = false;
    ctx.scheduleWander();
  }
}

export function navigateHome(ctx: WorkerCtx) {
  ctx.isReturningHome = true;
  ctx.faceTarget = null;
  ctx.arrivalFacing = null;
  const home = homeNavPoint(ctx);
  if (ctx.pathfinder) {
    const start = navPoint(ctx);
    const path = ctx.pathfinder.findPath(start.x, start.y, home.x, home.y);
    if (path && path.length > 1) {
      path.push(home);
      ctx.currentPath = path;
      ctx.pathIndex = 1;
      ctx.moveTarget = ctx.currentPath[1];
      return;
    }
  }
  ctx.currentPath = [];
  ctx.pathIndex = 0;
  ctx.moveTarget = home;
}
