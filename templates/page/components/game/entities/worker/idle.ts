import * as Phaser from "phaser";
import {
  WANDER_MIN_DELAY,
  WANDER_MAX_DELAY,
  WANDER_STAGGER_MS,
  POI_WANDER_CHANCE,
  POI_STAY_MIN,
  POI_STAY_MAX,
  STAGGER_EXTRA_MIN,
  STAGGER_EXTRA_MAX,
  SEAT_ACTIVITIES,
  POI_BUBBLE_TEXTS,
} from "@/lib/constants";
import type { WorkerCtx, POI } from "./types";

const wanderClock = { lastStartedAt: -Infinity };

export function resetWanderClock() {
  wanderClock.lastStartedAt = -Infinity;
}

function poiBubbleText(poiName: string): string {
  const lower = poiName.toLowerCase();
  // 精确关键词匹配：饮水机/打印机/书架/白板/沙发/咖啡/工作台各有对应文案
  const matches: Array<[string, string]> = [
    ["water", "water"],
    ["printer", "printer"],
    ["book", "book"],
    ["whiteboard", "whiteboard"],
    ["sofa", "sofa"],
    ["coffee", "coffee"],
    ["workbench", "workbench"],
  ];
  for (const [keyword, bucket] of matches) {
    if (lower.includes(keyword)) {
      const texts = POI_BUBBLE_TEXTS[bucket];
      return texts[Math.floor(Math.random() * texts.length)];
    }
  }
  return "到处走走看看";
}

export function stopIdleActivity(ctx: WorkerCtx) {
  if (ctx.wanderTimer) {
    ctx.wanderTimer.destroy();
    ctx.wanderTimer = null;
  }
  if (ctx.activityTimer) {
    ctx.activityTimer.destroy();
    ctx.activityTimer = null;
  }
  ctx.onArrival = null;
  ctx.isWandering = false;
  ctx.interactionLocked = false;
  ctx.hideEmote();
  ctx.bubble.hide();
}

export function scheduleWander(ctx: WorkerCtx) {
  stopIdleActivity(ctx);
  if (!ctx.canWander || ctx._status !== "idle") return;

  const delay = Phaser.Math.Between(WANDER_MIN_DELAY, WANDER_MAX_DELAY);
  if (ctx.wanderTimer) ctx.wanderTimer.destroy();
  ctx.wanderTimer = ctx.scene.time.delayedCall(delay, () => {
    tryStartWander(ctx);
  });
}

function tryStartWander(ctx: WorkerCtx) {
  if (!ctx.canWander || ctx._status !== "idle") return;

  const now = ctx.scene.time.now;
  const sinceLast = now - wanderClock.lastStartedAt;
  if (sinceLast < WANDER_STAGGER_MS) {
    const extraDelay =
      WANDER_STAGGER_MS - sinceLast + Phaser.Math.Between(STAGGER_EXTRA_MIN, STAGGER_EXTRA_MAX);
    if (ctx.wanderTimer) ctx.wanderTimer.destroy();
    ctx.wanderTimer = ctx.scene.time.delayedCall(extraDelay, () => {
      tryStartWander(ctx);
    });
    return;
  }

  wanderClock.lastStartedAt = now;
  startWander(ctx);
}

function startWander(ctx: WorkerCtx) {
  const goToPoi = ctx.pois.length > 0 && Math.random() < POI_WANDER_CHANCE;
  if (goToPoi) {
    wanderToPoi(ctx);
  } else {
    seatActivity(ctx);
  }
}

function wanderToPoi(ctx: WorkerCtx) {
  // 饮水机也是正常可去的场景（去时显示"接杯水"），不排除
  const poi = Phaser.Utils.Array.GetRandom(ctx.pois) as POI;
  ctx.isWandering = true;
  ctx.arrivalFacing = poi.facing ?? null;

  ctx.onArrival = () => {
    if (ctx._status !== "idle" || !ctx.canWander) return;
    ctx.showBubble(poiBubbleText(poi.name), POI_STAY_MIN);

    const stayDuration = Phaser.Math.Between(POI_STAY_MIN, POI_STAY_MAX);
    if (ctx.activityTimer) {
      ctx.activityTimer.destroy();
      ctx.activityTimer = null;
    }
    ctx.activityTimer = ctx.scene.time.delayedCall(stayDuration, () => {
      if (ctx._status !== "idle" || !ctx.canWander) return;
      ctx.onArrival = () => {
        ctx.isWandering = false;
        ctx.hideEmote();
        scheduleWander(ctx);
      };
      ctx.navigateHome();
      ctx.activityTimer = null;
    });
  };

  ctx.navigateTo(poi.x, poi.y, { x: poi.x, y: poi.y });
}

function seatActivity(ctx: WorkerCtx) {
  const def = Phaser.Utils.Array.GetRandom(SEAT_ACTIVITIES) as (typeof SEAT_ACTIVITIES)[number];
  const duration = Phaser.Math.Between(def.minDuration, def.maxDuration);

  ctx.showEmote(def.emote);

  if (ctx.activityTimer) {
    ctx.activityTimer.destroy();
    ctx.activityTimer = null;
  }
  ctx.activityTimer = ctx.scene.time.delayedCall(duration, () => {
    if (ctx._status !== "idle" || !ctx.canWander) return;
    ctx.hideEmote();
    scheduleWander(ctx);
    ctx.activityTimer = null;
  });
}
