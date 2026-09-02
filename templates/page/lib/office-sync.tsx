"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { SeatState } from "@/types/game";
import {
  STATIC_OFFICE_SNAPSHOT,
  getMemberByName,
  getTasksForMember,
  personComparableName,
  recommendAssignee,
  taskOwnedBy,
  type OfficeMember,
  type OfficeSnapshot,
  type OfficeTask,
} from "./office-data";
import { OFFICE_CONFIG } from "./office-config";
import { setAdminUnlocked } from "./admin-gate";
import { withBase } from "./base-path";
import { useStudio } from "./store";

let currentOfficeSnapshot: OfficeSnapshot = STATIC_OFFICE_SNAPSHOT;

/** HTML 离线交付模式：API 地址优先用导出器注入的后端地址，否则用部署前缀 */
function apiUrl(path: string): string {
  if (typeof window !== "undefined") {
    const injected = (window as unknown as { __OFFICE_API_BASE__?: string }).__OFFICE_API_BASE__;
    if (injected) return `${injected}${path}`;
  }
  return withBase(path);
}

export function getCurrentOfficeSnapshot() {
  return currentOfficeSnapshot;
}

export type OfficeWriteResult = {
  ok: boolean;
  verified?: boolean;
  error?: string;
  elapsedMs?: number;
};

type CreateTaskInput = {
  title: string;
  ownerName: string;
  projectId: string;
  /** 状态：用户在下拉里选的值；未选则后端默认"待办" */
  status?: string;
  description?: string;
  type?: string;
  priority?: string;
  importance?: string;
  stage?: string;
  startDate?: string;
  dueDate?: string;
  remark?: string;
  /** 客户表字段：真实字段名 -> 值。优先使用此字段，后端按飞书字段类型转换。 */
  fields?: Record<string, unknown>;
  /** 客户表额外字段：真实字段名 -> 值，原样写回 */
  extraFields?: Record<string, unknown>;
};

function cleanClientError(error: unknown, fallback = "飞书同步失败，请检查飞书授权状态或表格访问权限。") {
  const message = error instanceof Error ? error.message : String(error || "");
  if (
    message.includes("只读/可阅读权限") ||
    message.includes("没有编辑权限") ||
    message.includes("未找到可写入") ||
    message.includes("无法写入") ||
    message.includes("字段格式不正确") ||
    message.includes("不在可选范围")
  ) {
    return message;
  }
  if (
    !message ||
    message.includes("Command failed:") ||
    message.includes("lark-cli.cmd") ||
    message.includes("--base-token") ||
    message.includes("--table-id") ||
    message.includes("@./.office-live-lark-")
  ) {
    return fallback;
  }
  return message.length > 120 ? fallback : message;
}

type OfficeDataContextValue = {
  snapshot: OfficeSnapshot;
  loading: boolean;
  error?: string;
  lastSyncText: string;
  refresh: (force?: boolean, quiet?: boolean) => Promise<void>;
  reassignTask: (taskId: string, ownerName: string, reason?: string) => Promise<OfficeWriteResult>;
  createTask: (input: CreateTaskInput) => Promise<OfficeWriteResult>;
  getMemberByName: (name: string) => OfficeMember | undefined;
  getTasksForMember: (name: string) => OfficeTask[];
  recommendAssignee: (task: OfficeTask, currentOwner: string) => OfficeMember | undefined;
  /** 当前页面可用成员：主入口负责人 + 人员档案表 + 管理员，合并去重 */
  activeMembers: OfficeMember[];
  /** 是否已解锁管理权限（点 E/调整负责人/新增任务等写回操作的开关） */
  isAdmin: boolean;
  /** 校验管理口令；口令正确返回 true 并解锁（会话级，刷新需重输） */
  unlockAdmin: (code: string) => boolean;
};

const OfficeDataContext = createContext<OfficeDataContextValue | null>(null);

export function useOfficeData() {
  const ctx = useContext(OfficeDataContext);
  if (!ctx) throw new Error("useOfficeData must be used within OfficeDataProvider");
  return ctx;
}

function patchTaskOwner(snapshot: OfficeSnapshot, taskId: string, ownerName: string): OfficeSnapshot {
  return {
    ...snapshot,
    tasks: snapshot.tasks.map((task) => (task.id === taskId ? { ...task, owner: ownerName } : task)),
    syncedAt: new Date().toISOString(),
    source: "feishu",
  };
}

function appendTask(snapshot: OfficeSnapshot, task: OfficeTask): OfficeSnapshot {
  const projectName = snapshot.projects.find((project) => project.id === task.projectId)?.name;
  return {
    ...snapshot,
    tasks: [...snapshot.tasks, { ...task, projectName }],
    syncedAt: new Date().toISOString(),
    source: "feishu",
  };
}

function findMemberByComparableName(name: string, members: OfficeMember[]) {
  const exact = members.find((member) => member.name === name);
  if (exact) return exact;
  const target = personComparableName(name);
  const matches = members.filter((member) => target && personComparableName(member.name) === target);
  return matches.length === 1 ? matches[0] : undefined;
}

export function OfficeDataProvider({ children }: { children: ReactNode }) {
  // HTML 离线交付模式：导出器注入的快照优先显示（先看快照，再连后端刷新）
  const [snapshot, setSnapshot] = useState<OfficeSnapshot>(() => {
    if (typeof window !== "undefined" && (window as unknown as { __OFFICE_SNAPSHOT__?: OfficeSnapshot }).__OFFICE_SNAPSHOT__) {
      return (window as unknown as { __OFFICE_SNAPSHOT__: OfficeSnapshot }).__OFFICE_SNAPSHOT__;
    }
    return STATIC_OFFICE_SNAPSHOT;
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isAdmin, setIsAdmin] = useState(false);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  const refreshInFlightForceRef = useRef(false);
  const refreshSeqRef = useRef(0);

  // 管理口令校验：会话级解锁（刷新页面需重新输入）
  // 宽松匹配：忽略首尾空格、全角/半角、英文大小写（中英文都能输入）
  const unlockAdmin = useCallback((code: string) => {
    const expected = OFFICE_CONFIG.adminCode;
    if (!expected) {
      // 未配置口令 = 默认开放管理
      setAdminUnlocked(true);
      setIsAdmin(true);
      return true;
    }
    const norm = (s: string) =>
      s
        .trim()
        .replace(/[\uff01-\uff5e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
        .replace(/[ 　]/g, "")
        .toLowerCase();
    const ok = norm(code) === norm(expected);
    if (ok) {
      setAdminUnlocked(true);
      setIsAdmin(true);
    }
    return ok;
  }, []);

  const applySnapshot = useCallback((next: OfficeSnapshot) => {
    currentOfficeSnapshot = next;
    setSnapshot(next);
    setError(next.warning);
  }, []);

  const refresh = useCallback(
    async (force = false, quiet = false) => {
      if (refreshInFlightRef.current && (!force || refreshInFlightForceRef.current)) {
        return refreshInFlightRef.current;
      }
      if (!quiet) setLoading(true);
      refreshInFlightForceRef.current = force;
      const seq = ++refreshSeqRef.current;
      const request = (async () => {
        try {
          // 60 秒超时：快照接口为异步并行读飞书，正常 5-10s；留足余量避免误杀
          const controller = new AbortController();
          const timeout = window.setTimeout(() => controller.abort(), 60_000);
          try {
            const response = await fetch(apiUrl(`/api/office/snapshot${force ? "?force=1" : ""}`), {
              cache: "no-store",
              signal: controller.signal,
            });
            if (!response.ok) throw new Error(`读取飞书失败：${response.status}`);
            const next = (await response.json()) as OfficeSnapshot;
            if (seq === refreshSeqRef.current) applySnapshot(next);
          } finally {
            window.clearTimeout(timeout);
          }
        } catch (err) {
          setError(cleanClientError(err, "飞书数据读取失败，请检查授权或刷新表格。"));
        } finally {
          if (!quiet) setLoading(false);
          if (seq === refreshSeqRef.current) {
            refreshInFlightRef.current = null;
            refreshInFlightForceRef.current = false;
          }
        }
      })();
      refreshInFlightRef.current = request;
      return request;
    },
    [applySnapshot],
  );

  useEffect(() => {
    void refresh(true);
    // 飞书 → 页面：8 秒短轮询。轮询必须强制拉取，避免新打开页面先展示旧快照。
    const timer = window.setInterval(() => void refresh(false, true), 8_000);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh(true, true);
    };
    window.addEventListener("focus", refreshWhenVisible);
    window.addEventListener("online", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshWhenVisible);
      window.removeEventListener("online", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refresh]);

  const reassignTask = useCallback(
    async (taskId: string, ownerName: string, reason?: string) => {
      setLoading(true);
      const started = Date.now();
      try {
        const response = await fetch(apiUrl("/api/office/reassign"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskId, ownerName, reason }),
        });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.message ?? "写回飞书失败");
        applySnapshot(patchTaskOwner(snapshot, taskId, ownerName));
        // 后端已 read-back 校验通过；写回结果先返回，快照刷新在后台进行，避免全量读表/限流让弹窗卡住。
        void refresh(true, true);
        // 飞书写入后可能有短暂最终一致延迟，连续强制刷新几次，避免页面停在旧值。
        [1200, 3500, 8000].forEach((delay) => {
          window.setTimeout(() => void refresh(true, true), delay);
        });
        return { ok: true, verified: true, elapsedMs: result.elapsedMs };
      } catch (err) {
        const message = cleanClientError(err, "负责人写回失败：请确认表格可编辑，且负责人列是可写文本、人员或关联字段。");
        setError(message);
        return { ok: false, verified: false, error: message, elapsedMs: Date.now() - started };
      } finally {
        setLoading(false);
      }
    },
    [applySnapshot, refresh, snapshot],
  );

  const createTask = useCallback(
    async (input: CreateTaskInput) => {
      setLoading(true);
      const started = Date.now();
      try {
        const response = await fetch(apiUrl("/api/office/create-task"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.message ?? "新增任务失败");
        if (result.recordId) {
          applySnapshot(
            appendTask(snapshot, {
              id: result.recordId,
              title: input.title,
              owner: input.ownerName,
              status: input.status || "已新增",
              priority: input.priority || "",
              type: input.type || "",
              projectId: input.projectId,
              description: input.description,
              dueDate: input.dueDate || "",
              remainingText: "",
              overdue: false,
            }),
          );
        }
        // 后端已 read-back 校验；写回结果先返回，快照刷新在后台进行，避免全量读表/限流让弹窗卡住。
        void refresh(true, true);
        // 飞书写入后可能有短暂最终一致延迟，连续强制刷新几次，避免页面停在旧值。
        [1200, 3500, 8000].forEach((delay) => {
          window.setTimeout(() => void refresh(true, true), delay);
        });
        return { ok: true, verified: true, elapsedMs: result.elapsedMs };
      } catch (err) {
        const message = cleanClientError(err, "新增任务写回失败：请确认表格可编辑，且必填字段是可写字段。");
        setError(message);
        return { ok: false, verified: false, error: message, elapsedMs: Date.now() - started };
      } finally {
        setLoading(false);
      }
    },
    [applySnapshot, refresh, snapshot],
  );

  const lastSyncText = snapshot.syncedAt
    ? new Date(snapshot.syncedAt).toLocaleTimeString("zh-CN", { hour12: false })
    : "未同步";

  // 成员列表 = 全表有相关事项的人 + 管理员：
  // - 全表相关事项数大于 0 的人才占顶部条/地图工位，工作转走后自动退出
  // - 管理员是权限入口，哪怕当前 0 事项也常驻
  // - 纯档案人员仍保留在 snapshot.members 里供详情/分析和写回候选使用，但不强行占座
  const activeMembers = useMemo(() => {
    const ownerNames = new Set<string>(
      snapshot.tasks
        .flatMap((task) => task.owner.split(/[、,，;；]/).map((part) => part.trim()))
        .filter(Boolean),
    );
    const membersByName = new Map(snapshot.members.map((member) => [member.name, member]));
    const result: OfficeMember[] = [];
    const seen = new Set<string>();
    // 1) 先放主入口负责人，地图座位有限时优先让主入口事项负责人出现
    for (const name of ownerNames) {
      if (seen.has(name)) continue;
      const base = membersByName.get(name);
      result.push(
        base ?? {
          id: `owner-${name}`,
          name,
          employeeNo: "",
          role: "成员",
          level: "",
          skills: [],
          totalTasks: snapshot.tasks.filter((task) => taskOwnedBy(task, name)).length,
          todoTasks: 0,
          activeTasks: 0,
          doneTasks: 0,
          overdueTasks: 0,
          completion: "",
        },
      );
      seen.add(name);
    }
    // 2) 再补全表相关事项成员；人员档案表里的 0 事项非管理员不占地图/顶部位置
    for (const member of snapshot.members) {
      if (seen.has(member.name)) continue;
      if (member.totalTasks <= 0 && !findMemberByComparableName(OFFICE_CONFIG.ownerName, [member])) continue;
      result.push(member);
      seen.add(member.name);
    }
    // 3) 管理员兜底
    const ownerName = OFFICE_CONFIG.ownerName;
    if (ownerName) {
      const matched = findMemberByComparableName(ownerName, result);
      if (matched) {
        matched.role = matched.role === "成员" ? "管理员" : matched.role;
      } else if (!seen.has(ownerName)) {
        const base = findMemberByComparableName(ownerName, snapshot.members);
        result.push({
          id: base?.id ?? `owner-fixed-${ownerName}`,
          name: base?.name ?? ownerName,
          employeeNo: base?.employeeNo ?? "",
          role: base?.role ?? "管理员",
          level: base?.level ?? "",
          skills: base?.skills ?? [],
          totalTasks: snapshot.tasks.filter((task) => taskOwnedBy(task, base?.name ?? ownerName)).length,
          todoTasks: 0,
          activeTasks: 0,
          doneTasks: 0,
          overdueTasks: 0,
          completion: "",
        });
        seen.add(base?.name ?? ownerName);
      }
    }
    return result;
  }, [snapshot.members, snapshot.tasks]);

  const value = useMemo<OfficeDataContextValue>(
    () => ({
      snapshot,
      loading,
      error,
      lastSyncText,
      refresh,
      reassignTask,
      createTask,
      getMemberByName: (name) =>
        activeMembers.find((member) => member.name === name) ??
        getMemberByName(name, snapshot.members),
      getTasksForMember: (name) => getTasksForMember(name, snapshot.tasks),
      recommendAssignee: (task, currentOwner) =>
        recommendAssignee(task, currentOwner, activeMembers),
      activeMembers,
      isAdmin,
      unlockAdmin,
    }),
    [
      activeMembers,
      createTask,
      error,
      isAdmin,
      lastSyncText,
      loading,
      reassignTask,
      refresh,
      snapshot,
      unlockAdmin,
    ],
  );

  return <OfficeDataContext.Provider value={value}>{children}</OfficeDataContext.Provider>;
}

function sameSeatPatch(seat: SeatState, patch: Partial<SeatState>) {
  return Object.entries(patch).every(([key, value]) => seat[key as keyof SeatState] === value);
}

const emptySeatPatch: Partial<SeatState> = {
  assigned: false,
  label: "",
  roleTitle: undefined,
  seatType: "worker",
  spriteKey: undefined,
  spritePath: undefined,
  status: "empty",
  runId: undefined,
  taskSnippet: undefined,
  startedAt: undefined,
  agentConfig: undefined,
};

export function OfficeRosterSync() {
  const { state, updateSeatConfig } = useStudio();
  const { snapshot, activeMembers } = useOfficeData();
  const lastKeyRef = useRef("");

  useEffect(() => {
    if (state.seats.length === 0) return;

    const key = JSON.stringify({
      seats: state.seats.map((seat) => [seat.seatId, seat.label, seat.assigned]),
      members: activeMembers.map((member) => [
        member.id,
        member.name,
        member.role,
        member.totalTasks,
        member.overdueTasks,
      ]),
      taskOwners: snapshot.tasks.map((task) => task.owner),
    });
    if (lastKeyRef.current === key) return;
    lastKeyRef.current = key;

    // 座位分配：负责人坐老板位（boss 座位，地图里侧大工位），其余成员按表格顺序坐普通工位
    // 负责人外观用 09，其余成员用 01-06（一人一张，不重复）
    const ownerSprite = { key: "character_09", path: "/characters/Premade_Character_48x48_09.png" };
    const memberSprites = [
      { key: "character_02", path: "/characters/Premade_Character_48x48_02.png" },
      { key: "character_03", path: "/characters/Premade_Character_48x48_03.png" },
      { key: "character_04", path: "/characters/Premade_Character_48x48_04.png" },
      { key: "character_05", path: "/characters/Premade_Character_48x48_05.png" },
      { key: "character_06", path: "/characters/Premade_Character_48x48_06.png" },
      { key: "character_01", path: "/characters/Premade_Character_48x48_01.png" },
    ];

    const bossSeat = state.seats.find((seat) => seat.seatId === "boss");
    const workerSeats = state.seats.filter((seat) => seat.seatId !== "boss");
    const ownerMember = findMemberByComparableName(OFFICE_CONFIG.ownerName, activeMembers);
    const otherMembers = activeMembers.filter((member) => member.id !== ownerMember?.id);

    let memberSpriteIndex = 0;

    // 老板位：只坐负责人；没有负责人时留空
    if (bossSeat) {
      const patch: Partial<SeatState> = ownerMember
        ? {
            assigned: true,
            label: ownerMember.name,
            roleTitle: ownerMember.role || "成员",
            seatType: "worker",
            spriteKey: bossSeat.spriteKey ?? ownerSprite.key,
            spritePath: bossSeat.spritePath ?? ownerSprite.path,
          }
        : emptySeatPatch;
      if (!sameSeatPatch(bossSeat, patch)) updateSeatConfig(bossSeat.seatId, patch);
    }

    // 普通工位：按表格顺序坐其余成员（负责人不占普通位）
    workerSeats.forEach((seat) => {
      const member = otherMembers[memberSpriteIndex];
      let sprite: { key: string; path: string } | undefined;
      if (member) {
        sprite = memberSprites[memberSpriteIndex % memberSprites.length];
      }
      const patch: Partial<SeatState> = member
        ? {
            assigned: true,
            label: member.name,
            roleTitle: member.role || "成员",
            seatType: "worker",
            spriteKey: seat.spriteKey ?? sprite?.key,
            spritePath: seat.spritePath ?? sprite?.path,
          }
        : {
            ...emptySeatPatch,
          };
      if (!sameSeatPatch(seat, patch)) updateSeatConfig(seat.seatId, patch);
      if (member) memberSpriteIndex++;
    });
  }, [activeMembers, snapshot.tasks, state.seats, updateSeatConfig]);

  return null;
}
