/** 字段语义类型：数据特征判断（不靠字段名预设），识别不出的归 other */
export type OfficeFieldKind =
  | "name" // 名称类：记录叫什么
  | "person" // 人员类：谁负责/谁参与（聚合成员、旅程匹配）
  | "status" // 状态类：值少且短文本（状态分布、分组）
  | "date" // 日期类：类型是日期（超期/临期/排序）
  | "number" // 数字类：类型是数字/货币（汇总/均值/占比）
  | "group" // 分组类：值去重 2-50 个（按项目/门店/区域聚合）
  | "link" // 关联类：飞书关联字段（link，写回需用目标表记录 ID 数组）
  | "text" // 文本类：其他所有字段（原样展示）
  | "other"; // 识别不出的（照样展示）

/** 单条记录：原始字段名 -> 值（全字段保留，一个不丢） */
export type OfficeTableRecord = {
  id: string;
  fields: Record<string, unknown>;
};

/** 一张客户表：表名 + 记录 + 字段语义标注 + 字段真实类型 + select 选项 */
export type OfficeTable = {
  id: string;
  title: string; // 客户表真实表名
  role: string; // 语义角色（tasks/members/... 兼容用）
  fieldKinds: Record<string, OfficeFieldKind>; // 字段名 -> 语义类型
  /** 飞书真实字段类型：字段名 -> 类型码（1=Text 2=Number 3=SingleSelect 4=MultiSelect 5=DateTime 7=人员） */
  fieldTypes: Record<string, number>;
  /** select 字段选项：字段名 -> 可选值列表（写回下拉、表单渲染） */
  fieldOptions: Record<string, string[]>;
  /** 百分比字段名列表（formatter 含 %，如完成度：前端按 0-100 填、写回转 0-1） */
  fieldPercents?: string[];
  /** 关联字段目标表：字段名 -> { 目标表 ID, 目标表名 }（link 字段渲染下拉用） */
  fieldLinks?: Record<string, { tableId: string; tableName: string }>;
  records: OfficeTableRecord[];
};

export type OfficeMember = {
  id: string;
  name: string;
  employeeNo: string;
  role: string;
  level: string;
  skills: string[];
  totalTasks: number;
  todoTasks: number;
  activeTasks: number;
  doneTasks: number;
  overdueTasks: number;
  completion: string;
  /** 状态列真实值分布：展示真实维度，不硬套待办/进行中 */
  statusDist?: { value: string; count: number }[];
};

export type OfficeTask = {
  id: string;
  title: string;
  owner: string;
  status: string;
  priority: string;
  type: string;
  dueDate: string;
  remainingText: string;
  overdue: boolean;
  /** 临期（3 天内到期，由截止日期计算，不依赖表格公式字段） */
  dueSoon?: boolean;
  projectId?: string;
  projectName?: string;
  milestoneIds?: string[];
  description?: string;
  /** 事项进展（主入口表有「完成度/进度」列时实时读取，0-1 或 0-100 归一后存 0-100） */
  completion?: number;
  /** 是否达成终态：主状态列 + 表内全部生命周期列（客户状态/回款状态/…）任一命中终态词即 true。
   *  客户表"客户状态=已成交"或"回款状态=已回款"都算完成；不只看单个 status 列。 */
  done?: boolean;
  /** 回款/收款类生命周期列的值（如"已回款/部分回款/未回款"）；表里没有回款列则为 undefined。
   *  用于「特别关注」的催收判定：已成交但未全额回款的客户仍需关注。 */
  payment?: string;
  /** 主入口表原始字段名和值，用于通用摘要和详情展示；不参与写回判断。 */
  rawFields?: Record<string, unknown>;
};

export type OfficeProject = {
  id: string;
  name: string;
  status: string;
  priority: string;
  progress: string;
  members: string[];
  totalTasks: number;
  riskCount: number;
  dueDate: string;
};

export type OfficeRisk = {
  id: string;
  title: string;
  owner: string;
  level: string;
  status: string;
  dueDate: string;
  action: string;
  projectId?: string;
  projectName?: string;
  taskIds?: string[];
};

export type OfficeMilestone = {
  id: string;
  name: string;
  owner: string;
  status: string;
  dueDate: string;
  actualDate?: string;
  deliverable?: string;
  projectId?: string;
  projectName?: string;
  taskIds: string[];
};

export type OfficeAnalysisSource = {
  table: string;
  field: string;
  role: string;
};

export type OfficeFieldSummary = {
  table: string;
  field: string;
  kind: OfficeFieldKind;
  type?: number;
  nonEmpty: number;
  empty: number;
  examples: string[];
  topValues: { value: string; count: number }[];
  number?: { sum: number; min: number; max: number; avg: number };
};

export type OfficeSubjectMap = {
  mainTable: string;
  workItem?: string;
  people: string[];
  businessSubjects: string[];
  valueFields: string[];
  statusFields: string[];
  timeFields: string[];
  relationFields: string[];
  readonlyFields: string[];
};

export type OfficeAnalysisInsight = {
  id: string;
  title: string;
  summary: string;
  severity: "info" | "attention" | "risk";
  sources: OfficeAnalysisSource[];
};

export type OfficeTableProfile = {
  table: string;
  tableId: string;
  recordCount: number;
  fieldCount: number;
  nameFields: string[];
  personFields: string[];
  statusFields: string[];
  timeFields: string[];
  valueFields: string[];
  ratioFields: string[];
  relationFields: string[];
  readonlyFields: string[];
  writableFields: string[];
};

export type OfficeProgressSummary = {
  label: string;
  value: number;
  text: string;
  method: string;
  sources: OfficeAnalysisSource[];
};

export type OfficePersonJourney = {
  name: string;
  recordCount: number;
  tableCount: number;
  tables: { table: string; count: number }[];
  progress?: OfficeProgressSummary;
  highlights: string[];
};

function isRecordIdText(value: string): boolean {
  return /^rec[a-zA-Z0-9]{8,}$/.test(value.trim());
}

export type OfficeAnalysis = {
  subjectMap: OfficeSubjectMap;
  fieldSummaries: OfficeFieldSummary[];
  insights: OfficeAnalysisInsight[];
  tableProfiles?: OfficeTableProfile[];
  personJourneys?: OfficePersonJourney[];
  warnings: string[];
};

export type OfficeSnapshot = {
  baseTitle: string;
  /** 所有客户表 + 全部字段（通用化核心：表里有什么就有什么） */
  tables: OfficeTable[];
  members: OfficeMember[];
  tasks: OfficeTask[];
  projects: OfficeProject[];
  risks: OfficeRisk[];
  milestones: OfficeMilestone[];
  /** Codex 改造：所有页面分析统一从这里取，避免组件各自猜字段 */
  analysis?: OfficeAnalysis;
  syncedAt: string;
  source: "feishu" | "static";
  warning?: string;
};

export const OFFICE_BASE_TITLE = "Office Live";

/**
 * 通用字段值转可读文本（任何表、任何字段类型都适用，不写死）：
 * - 纯文本/数字/日期 → 原样
 * - 关联字段（对象/对象数组，如 [{id,text}]）→ 取 text/name，取不到显示关联数量
 * - 多选数组 → 顿号连接
 * - 嵌套/未知结构 → 递归取出非空值，绝不出 [object Object]
 */
export function fieldValueText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") {
    const isoDate = value.match(/^(\d{4}-\d{2}-\d{2})T/);
    if (isoDate) return isoDate[1];
    const slashDate = value.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?/);
    if (slashDate) {
      const [, y, m, d] = slashDate;
      return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
    return isRecordIdText(value) ? "已关联 1 条" : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts = value.map(fieldValueText).filter(Boolean);
    if (parts.length > 0 && parts.every((part) => part === "已关联 1 条")) return `已关联 ${parts.length} 条`;
    return parts.join("、");
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    // 关联字段：优先可读名称；解析不到名称时不外露 record id
    for (const key of ["text", "name"]) {
      const v = obj[key];
      if (v != null && fieldValueText(v).trim() !== "") return fieldValueText(v);
    }
    if (obj.value != null && fieldValueText(obj.value).trim() !== "") return fieldValueText(obj.value);
    for (const key of ["id", "record_id", "recordId"]) {
      if (obj[key] != null) return "已关联 1 条";
    }
    // 兜底：把对象里所有非空值拼起来（不显示 [object Object]）
    const parts = Object.entries(obj)
      .filter(([, v]) => v != null && v !== "")
      .map(([, v]) => fieldValueText(v))
      .filter(Boolean);
    return parts.join(" ");
  }
  return String(value);
}

function isDateFieldName(field: string) {
  return /日期|时间|期限|到期|过期|截止|签约|生效|跟进|沟通|回访|拜访|预约|续约|date|time|deadline|expire|due|signed|effective|follow|contact|visit|renew/i.test(field);
}

function excelSerialDate(value: number) {
  if (!Number.isFinite(value) || value < 25_000 || value > 80_000) return "";
  const utc = Math.round((value - 25569) * 86_400_000);
  const d = new Date(utc);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export function fieldDisplayText(field: string, value: unknown): string {
  if (isDateFieldName(field)) {
    if (typeof value === "number") return excelSerialDate(value) || fieldValueText(value);
    if (typeof value === "string" && /^\d{5}$/.test(value.trim())) {
      return excelSerialDate(Number(value.trim())) || fieldValueText(value);
    }
  }
  const text = fieldValueText(value);
  const isoDateTime = text.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (isoDateTime) return isoDateTime[1];
  return text;
}

export function personComparableName(name: string) {
  const clean = String(name || "").trim();
  if (!clean) return "";
  const parts = clean.split(/[·\-_/／｜|]/).map((part) => part.trim()).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : clean;
}

export const OFFICE_MEMBERS: OfficeMember[] = [
  {
    id: "demo-member-1",
    name: "成员A",
    employeeNo: "001",
    role: "项目管理",
    level: "P7",
    skills: ["项目管理", "AI应用"],
    totalTasks: 10,
    todoTasks: 5,
    activeTasks: 1,
    doneTasks: 4,
    overdueTasks: 1,
    completion: "40%",
  },
  {
    id: "demo-member-2",
    name: "成员B",
    employeeNo: "002",
    role: "前端工程师",
    level: "P6",
    skills: ["Vue", "React"],
    totalTasks: 9,
    todoTasks: 4,
    activeTasks: 1,
    doneTasks: 4,
    overdueTasks: 0,
    completion: "44%",
  },
  {
    id: "demo-member-3",
    name: "成员C",
    employeeNo: "003",
    role: "测试工程师",
    level: "P6",
    skills: ["自动化测试", "Python"],
    totalTasks: 10,
    todoTasks: 5,
    activeTasks: 1,
    doneTasks: 4,
    overdueTasks: 1,
    completion: "40%",
  },
  {
    id: "demo-member-4",
    name: "成员D",
    employeeNo: "004",
    role: "产品经理",
    level: "P7",
    skills: ["数据分析", "项目管理"],
    totalTasks: 3,
    todoTasks: 2,
    activeTasks: 0,
    doneTasks: 0,
    overdueTasks: 1,
    completion: "0%",
  },
  {
    id: "demo-member-5",
    name: "成员E",
    employeeNo: "005",
    role: "运营",
    level: "P5",
    skills: ["数据分析"],
    totalTasks: 2,
    todoTasks: 0,
    activeTasks: 2,
    doneTasks: 0,
    overdueTasks: 0,
    completion: "0%",
  },
];

export const OFFICE_PROJECTS: OfficeProject[] = [
  {
    id: "demo-project-1",
    name: "示例项目A",
    status: "开发中",
    priority: "P0 紧急",
    progress: "40%",
    members: ["成员C", "成员B", "成员D"],
    totalTasks: 5,
    riskCount: 1,
    dueDate: "2026-09-15",
  },
  {
    id: "demo-project-2",
    name: "示例项目B",
    status: "UI设计",
    priority: "P1 高",
    progress: "25%",
    members: ["成员A", "成员B"],
    totalTasks: 4,
    riskCount: 1,
    dueDate: "2026-09-30",
  },
];

export const OFFICE_TASKS: OfficeTask[] = [
  {
    id: "demo-task-1",
    title: "数据仓库建模",
    owner: "成员A",
    status: "进行中",
    priority: "P1 高",
    type: "技术任务",
    dueDate: "2026-08-20",
    remainingText: "超期4天",
    overdue: true,
    projectId: "demo-project-1",
    projectName: "示例项目A",
  },
  {
    id: "demo-task-2",
    title: "工单自动分派",
    owner: "成员E",
    status: "进行中",
    priority: "P1 高",
    type: "技术任务",
    dueDate: "2026-08-24",
    remainingText: "剩0天",
    overdue: false,
    projectId: "demo-project-2",
    projectName: "示例项目B",
  },
];

export const OFFICE_RISKS: OfficeRisk[] = [
  {
    id: "demo-risk-1",
    title: "接口性能不达标",
    owner: "成员B",
    level: "高",
    status: "处理中",
    dueDate: "2026-08-26",
    action: "加缓存和异步化，本周内完成优化并复测",
    projectId: "demo-project-1",
    projectName: "示例项目A",
  },
];

export const STATIC_OFFICE_SNAPSHOT: OfficeSnapshot = {
  baseTitle: OFFICE_BASE_TITLE,
  // 初始不展示演示成员/任务，等待飞书数据加载（避免"先 5 人后变 7 人"的闪烁）
  tables: [],
  members: [],
  tasks: [],
  projects: [],
  risks: [],
  milestones: [],
  syncedAt: new Date().toISOString(),
  source: "static",
};

/** 状态归类：不预设词表。表里有状态列就取真实值，由展示层按真实 status 值分组。 */
// DONE_WORDS 已移除：不预设终态词表
// RUNNING_WORDS 已移除：不预设进行中词表
// TODO_WORDS 已移除：不预设待办词表

export function isTaskDone(task: OfficeTask) {
  // 不预设终态词表。task.done 由快照层计算（当前不把业务词硬塞进完成）。
  return Boolean(task.done);
  // (原 DONE_WORDS 判定已移除)
}

/**
 * 成员工作概况文本：按状态列真实值分区展示（分布和 = 总事项，不重复计数）——
 * 任务表显示「进行中 1 · 已完成 1」，客户表显示「跟进中 2 · 已成交 1」。超期/临期是任务上的高亮标记，不计入分区。
 */
export function memberStatusText(m: OfficeMember): string {
  const dist = m.statusDist ?? [];
  if (dist.length > 0) {
    return dist.map((d) => `${d.value} ${d.count}`).join(" · ");
  }
  const parts: string[] = [];
  if (m.activeTasks > 0) parts.push(`${m.activeTasks} 进行中`);
  if (m.todoTasks > 0) parts.push(`${m.todoTasks} 待办`);
  if (m.doneTasks > 0) parts.push(`${m.doneTasks} 完成`);
  return parts.join(" · ");
}

export function isTaskRunning(task: OfficeTask) {
  return false; // 不预设词表，展示层用真实 status 值分组
}

export function isTaskTodo(task: OfficeTask) {
  return false; // 不预设词表，展示层用真实 status 值分组
}

/** 状态识别兜底：不是"完成"类状态就视为未完成（保证全部任务都进旅程，一个不丢） */
export function isTaskOpen(task: OfficeTask) {
  return !isTaskDone(task);
}

export function isTaskDueSoon(task: OfficeTask) {
  if (task.overdue || isTaskDone(task)) return false;
  // 优先用计算出的 dueSoon（截止日期算的，任何表都准）
  if (task.dueSoon) return true;
  // 兼容：旧数据/公式字段的"剩 N 天"
  const match = task.remainingText.match(/剩\s*(\d+)\s*天/);
  if (!match) return false;
  const days = Number(match[1]);
  return Number.isFinite(days) && days <= 3;
}

/** 负责人是否包含某成员：兼容多人负责人（顿号分隔），如 owner="成员A、成员B" 匹配 "成员A" */
export function taskOwnedBy(task: OfficeTask, name: string): boolean {
  if (!task.owner) return false;
  if (task.owner === name) return true;
  const target = personComparableName(name);
  return task.owner.split(/[、,，;；]/).some((part) => {
    const clean = part.trim();
    return clean === name || (target !== "" && personComparableName(clean) === target);
  });
}

export function getTasksForMember(name: string, tasks: OfficeTask[] = OFFICE_TASKS) {
  return tasks.filter((task) => taskOwnedBy(task, name));
}

export function getMemberByName(name: string, members: OfficeMember[] = OFFICE_MEMBERS) {
  const exact = members.find((member) => member.name === name);
  if (exact) return exact;
  const target = personComparableName(name);
  const matches = members.filter((member) => target && personComparableName(member.name) === target);
  return matches.length === 1 ? matches[0] : undefined;
}

export function recommendAssignee(
  task: OfficeTask,
  currentOwner: string,
  members: OfficeMember[] = OFFICE_MEMBERS,
) {
  const candidates = members.filter((member) => member.name !== currentOwner);
  const sameRoleHint =
    task.type.includes("缺陷") || task.type.includes("测试")
      ? "测试"
      : task.type.includes("需求") || task.type.includes("产品")
        ? "产品"
        : task.type.includes("设计")
          ? "设计"
          : "";

  return [...candidates].sort((a, b) => {
    const score = (member: OfficeMember) =>
      member.activeTasks * 3 +
      member.todoTasks +
      member.overdueTasks * 5 -
      (sameRoleHint && member.role.includes(sameRoleHint) ? 4 : 0);
    return score(a) - score(b);
  })[0];
}
