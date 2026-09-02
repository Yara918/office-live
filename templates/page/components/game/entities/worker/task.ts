import { TASK_RESULT_HOLD_MS, TASK_BUBBLE_MS, TASK_THINK_DELAY_MS } from "@/lib/constants";
import { isAtHomePose } from "./movement";
import type { WorkerCtx } from "./types";

export function assignTask(
  ctx: WorkerCtx,
  runId: string,
  taskMessage: string,
  onReady?: () => void,
) {
  ctx.stopIdleActivity();
  ctx.assignedRunId = runId;
  ctx.currentTaskMessage = taskMessage;
  ctx.setStatus("working");

  const beginProcessing = () => {
    ctx.showBubble(`📋 ${taskMessage}`, TASK_BUBBLE_MS);
    onReady?.();
    if (ctx.taskVisualTimer) {
      ctx.taskVisualTimer.destroy();
      ctx.taskVisualTimer = null;
    }
    ctx.taskVisualTimer = ctx.scene.time.delayedCall(TASK_THINK_DELAY_MS, () => {
      if (ctx._status === "working") ctx.showEmote("emote:dots");
      ctx.taskVisualTimer = null;
    });
  };

  const shouldReturnHomeFirst = ctx.moveTarget !== null || !isAtHomePose(ctx) || ctx.isWandering;
  if (shouldReturnHomeFirst) {
    ctx.interactionLocked = true;
    ctx.showBubble("回到工位处理任务...", TASK_BUBBLE_MS);
    ctx.onArrival = () => {
      ctx.interactionLocked = false;
      beginProcessing();
    };
    ctx.navigateHome();
    return;
  }

  beginProcessing();
}

export function completeTask(ctx: WorkerCtx) {
  if (ctx.taskVisualTimer) {
    ctx.taskVisualTimer.destroy();
    ctx.taskVisualTimer = null;
  }
  ctx.currentTaskMessage = null;
  ctx.setStatus("done");

  ctx.taskVisualTimer = ctx.scene.time.delayedCall(TASK_RESULT_HOLD_MS, () => {
    if (ctx._status === "done") {
      ctx.setStatus("idle");
      ctx.assignedRunId = null;
      processQueue(ctx);
    }
    ctx.taskVisualTimer = null;
  });
}

export function failTask(ctx: WorkerCtx) {
  if (ctx.taskVisualTimer) {
    ctx.taskVisualTimer.destroy();
    ctx.taskVisualTimer = null;
  }
  ctx.currentTaskMessage = null;
  ctx.setStatus("failed");
  ctx.showBubble("Task failed.", TASK_BUBBLE_MS);
  ctx.taskVisualTimer = ctx.scene.time.delayedCall(TASK_RESULT_HOLD_MS, () => {
    ctx.assignedRunId = null;
    ctx.setStatus("idle");
    processQueue(ctx);
    ctx.taskVisualTimer = null;
  });
}

export function abortTask(ctx: WorkerCtx, runId: string): boolean {
  const queuedIndex = ctx.taskQueue.findIndex((task) => task.runId === runId);
  if (queuedIndex >= 0) {
    ctx.taskQueue.splice(queuedIndex, 1);
    ctx.showBubble("Queued task removed.", 2500);
    return true;
  }

  if (ctx.assignedRunId !== runId) {
    return false;
  }

  ctx.currentTaskMessage = null;
  if (ctx.taskVisualTimer) {
    ctx.taskVisualTimer.destroy();
    ctx.taskVisualTimer = null;
  }

  ctx.stopIdleActivity();
  ctx.assignedRunId = null;
  ctx.showBubble("Task stopped.", TASK_BUBBLE_MS);
  ctx.taskVisualTimer = ctx.scene.time.delayedCall(TASK_RESULT_HOLD_MS, () => {
    ctx.taskVisualTimer = null;
    ctx.setStatus("idle");
    processQueue(ctx);
  });
  return true;
}

export function enqueueTask(ctx: WorkerCtx, runId: string, message: string, onReady?: () => void) {
  ctx.taskQueue.push({ runId, message, onReady });
  const queueSize = ctx.taskQueue.length;
  const preview = message.length > 18 ? `${message.slice(0, 18)}...` : message;
  ctx.showBubble(`Queued #${queueSize}: ${preview}`, 3000);
}

function processQueue(ctx: WorkerCtx) {
  if (ctx.taskQueue.length === 0) return;
  const next = ctx.taskQueue.shift()!;
  assignTask(ctx, next.runId, next.message, next.onReady);
}
