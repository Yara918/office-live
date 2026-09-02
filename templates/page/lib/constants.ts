import type { ConnectionStatus } from "@/types/game";

export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;

export const INTERACT_DISTANCE = 48;
export const BOSS_INTERACT_DISTANCE = 34;

export const PF_CELL_SIZE = 16;
export const PF_PADDING = 8;
export const PF_MAX_ITER = 20000;

export const WANDER_MIN_DELAY = 3000;
export const WANDER_MAX_DELAY = 10000;
export const WANDER_STAGGER_MS = 1800;
export const WANDER_INITIAL_MIN = 500;
export const WANDER_INITIAL_MAX = 4000;

export const ARRIVE_THRESHOLD = 8;
export const WORKER_SPEED_FACTOR = 0.55;
export const STUCK_FRAME_LIMIT = 120;
export const TASK_RESULT_HOLD_MS = 4500;
export const TASK_BUBBLE_MS = 4000;
export const TASK_THINK_DELAY_MS = 4200;

export const POI_WANDER_CHANCE = 0.35;
export const POI_STAY_MIN = 3000;
export const POI_STAY_MAX = 6000;
export const STAGGER_EXTRA_MIN = 250;
export const STAGGER_EXTRA_MAX = 1200;

export const EMOTE_Y_OFFSET = 0.55;
export const BUBBLE_Y_OFFSET = 0.45;
export const PROMPT_Y_OFFSET = 0.5;

export const BODY_SIZE_RATIO_W = 0.5;
export const BODY_SIZE_RATIO_H = 0.2;
export const BODY_OFFSET_RATIO_X = 0.25;
export const BODY_OFFSET_RATIO_Y = 0.75;

export const STUCK_MOVE_THRESHOLD = 0.5;

export const STATUS_LABELS: Record<ConnectionStatus, string> = {
  disconnected: "本地运行",
  connecting: "连接中",
  connected: "已连接",
  error: "连接异常",
  auth_failed: "本地运行",
  unreachable: "本地运行",
  rate_limited: "本地运行",
};

export const LS_CONFIG = "agent-town:gateway-config";
export const LS_TASKS = "agent-town:tasks";
export const LS_CHAT = "agent-town:chat";
export const LS_SESSIONS = "agent-town:sessions";
export const LS_ACTIVE_KEY = "agent-town:active-session-key";
export const LS_SEAT_CONFIG = "office-live:seat-config:v1";
export const LS_BGM_VOLUME = "agent-town:bgm-volume";
export const LS_ONBOARDING_DONE = "agent-town:onboarding-done";

export const DEFAULT_BGM_VOLUME = 0.45;

export const MAX_CHAT = 500;
export const MAX_SESSIONS = 20;

export interface SeatActivityDef {
  emote: string;
  bubbles: string[];
  minDuration: number;
  maxDuration: number;
}

export const SEAT_ACTIVITIES: SeatActivityDef[] = [
  {
    emote: "emote:thinking",
    bubbles: ["梳理方案中", "想一个更稳的做法", "这里需要对齐口径"],
    minDuration: 5000,
    maxDuration: 10000,
  },
  {
    emote: "emote:thinking",
    bubbles: ["看需求文档", "记录关键点", "确认交付边界"],
    minDuration: 5000,
    maxDuration: 10000,
  },
  {
    emote: "emote:device",
    bubbles: ["专注推进中", "处理任务中", "检查细节中"],
    minDuration: 5000,
    maxDuration: 12000,
  },
  {
    emote: "emote:device",
    bubbles: ["整理交付内容", "快收尾了", "再确认一遍"],
    minDuration: 4000,
    maxDuration: 8000,
  },
  {
    emote: "emote:star",
    bubbles: ["思路清楚了", "这个方案可行", "找到突破口了"],
    minDuration: 2000,
    maxDuration: 4000,
  },
  {
    emote: "emote:heart",
    bubbles: ["状态不错", "节奏保持住", "协作顺利"],
    minDuration: 3000,
    maxDuration: 5000,
  },
  {
    emote: "emote:music",
    bubbles: ["听歌专注中", "保持节奏", "轻松推进"],
    minDuration: 3000,
    maxDuration: 6000,
  },
  {
    emote: "emote:confused",
    bubbles: ["这里有点卡住", "需要确认一下", "这个点有疑问"],
    minDuration: 3000,
    maxDuration: 6000,
  },
  {
    emote: "emote:angry",
    bubbles: ["这个问题有点棘手", "需要集中处理", "先把风险压住"],
    minDuration: 2000,
    maxDuration: 4000,
  },
];

export const POI_BUBBLE_TEXTS: Record<string, string[]> = {
  water: ["接杯水喝", "补水一下", "顺便放松会儿"],
  printer: ["确认材料", "打印资料", "整理文件"],
  book: ["查资料", "翻参考文档", "补充背景信息"],
  whiteboard: ["复盘计划", "画一下流程", "同步关键节点"],
  sofa: ["短暂休息", "换个状态", "放松一下"],
  coffee: ["来杯咖啡", "补充能量", "继续推进"],
  workbench: ["整理工具", "调试设备", "检查物料"],
};

export const BOSS_PROMPT_OFFSET_X = 40;
export const BOSS_PROMPT_OFFSET_Y = 16;
export const CAMERA_LERP = 0.1;
export const ZOOM_SENSITIVITY = 0.001;
export const ZOOM_DEFAULT = 0.82;
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2;
export const CAMERA_DRAG_THRESHOLD = 3;

export const PRESS_E_STYLE: {
  fontFamily: string;
  fontSize: string;
  color: string;
  backgroundColor: string;
  padding: { x: number; y: number };
  align: string;
} = {
  fontFamily: '"SF Mono", "Cascadia Code", Consolas, "Liberation Mono", Menlo, monospace',
  fontSize: "14px",
  color: "#c9a227",
  backgroundColor: "rgba(37, 34, 25, 0.95)",
  padding: { x: 8, y: 4 },
  align: "center",
};

export function isVisibleChatMessage(msg: { role: string; content: string }) {
  return !(msg.role === "system" && msg.content.startsWith("Connected to "));
}

export function formatCompact(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return `${Math.round(value)}`;
}

export function formatModelLabel(model?: string) {
  if (!model) return "本地运行";
  if (model.length <= 22) return model;
  const pieces = model.split(/[/:]/).filter(Boolean);
  const tail = pieces[pieces.length - 1];
  return tail && tail.length <= 22 ? tail : `${model.slice(0, 19)}...`;
}

export function formatRelativeTime(iso?: string) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  return `${Math.floor(hours / 24)}天前`;
}
