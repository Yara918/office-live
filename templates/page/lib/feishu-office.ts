import {
  STATIC_OFFICE_SNAPSHOT,
  fieldValueText,
  personComparableName,
  type OfficeFieldKind,
  type OfficeMember,
  type OfficeMilestone,
  type OfficeProject,
  type OfficeRisk,
  type OfficeSnapshot,
  type OfficeTable,
  type OfficeTask,
} from "./office-data";
import { OFFICE_CONFIG, fieldsOf } from "./office-config";
import {
  fieldList,
  larkJson,
  recordCreateRaw,
  recordGetRaw,
  recordListRaw,
  recordUpdateRaw,
  type LarkRecordRow,
} from "./lark-bridge";
import { inferTableSemantics, type FieldProfile, type SemanticField } from "./analysis";
import { buildOfficeAnalysis } from "./analysis-engine";

const BASE_TOKEN = OFFICE_CONFIG.baseToken;
const FIELDS = {
  tasks: fieldsOf("tasks"),
  members: fieldsOf("members"),
  projects: fieldsOf("projects"),
  risks: fieldsOf("risks"),
  milestones: fieldsOf("milestones"),
};
const TBL = Object.fromEntries(OFFICE_CONFIG.tables.map((t) => [t.role, t.id])) as Record<
  "tasks" | "members" | "projects" | "risks" | "milestones",
  string
>;

export type CreateOfficeTaskInput = {
  title: string;
  ownerName: string;
  /** 所属分组/项目：客户表可能没有该字段，允许为空 */
  projectId?: string;
  /** 状态：用户在下拉里选的值（客户表已有的选项）；未选默认"待办" */
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
  /** 客户表额外字段（语义位之外的字段）：真实字段名 -> 值，原样写回 */
  extraFields?: Record<string, unknown>;
};

/** 写回结果：read-back 校验通过才算 verified */
export type OfficeWriteOutcome = {
  ok: boolean;
  verified: boolean;
  recordId?: string;
  readBack?: Record<string, unknown>;
  error?: string;
  elapsedMs: number;
  /** 单字段未写入的说明（其他字段已保存成功） */
  warnings?: string[];
};

type RecordTable = {
  records: Array<Record<string, unknown> & { _recordId: string }>;
};

let snapshotCache: OfficeSnapshot | null = null;
let snapshotCacheAt = 0;
let snapshotInFlight: Promise<OfficeSnapshot> | null = null;
let snapshotVersion = 0;
// 快照 TTL 8 秒：配合前端 8 秒轮询（非 force），轮询多数命中缓存、页面秒开；force=1（手动刷新/写回后）才全量重建
const SNAPSHOT_CACHE_MS = 8_000;
function rememberSnapshot(snapshot: OfficeSnapshot, version = snapshotVersion) {
  if (version !== snapshotVersion) return;
  snapshotCache = snapshot;
  snapshotCacheAt = Date.now();
}

function invalidateSnapshotCache() {
  snapshotVersion += 1;
  snapshotCache = null;
  snapshotCacheAt = 0;
}

export function publicFeishuError(error: unknown, fallback = "飞书同步失败，请检查飞书授权状态或表格访问权限。") {
  const message = error instanceof Error ? error.message : String(error || "");
  if (!message) return fallback;
  // 飞书错误码 → 明确提示（不显示乱码/代码）
  const codeMap: Array<[RegExp, string]> = [
    [/1254061|NumberFieldConvFail/i, "数字字段格式不正确：请填写数字（如 1000），不要带文字。"],
    [/1254064|DatetimeFieldConvFail/i, "日期字段格式不正确：请选择日期（如 2026-08-27）。"],
    [/1254060|TextFieldConvFail/i, "文本字段格式不正确：请填写文字。"],
    [/1254074|SingleSelectFieldConvFail/i, "选项字段不正确：请从下拉框选择已有的选项。"],
    [/1254075|MultiSelectFieldConvFail/i, "多选字段不正确：请从下拉框选择已有的选项。"],
    [/1254004|WrongTableId/i, "表格配置有误：找不到对应的表，请重新生成。"],
    [/91402|NOTEXIST/i, "表格或记录不存在：可能已被删除，请刷新表格。"],
    [/91403|Forbidden/i, "当前账号对该表格没有编辑权限（链接为「可阅读」或您不是表主/协作者），请在多维表格「分享」中把权限改为「互联网上获得链接的人可编辑」，保存后刷新页面。"],
  ];
  for (const [re, hint] of codeMap) {
    if (re.test(message)) return hint;
  }
  const cleaned = message
    .replace(/C:\\[^"\\\n]+\\lark-cli\.cmd/g, "lark-cli")
    .replace(/--base-token[^\s]+/g, "")
    .replace(/--table-id[^\s]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || cleaned.length > 140) return fallback;
  return cleaned;
}

/** OpenAPI 记录行转 RecordTable（字段名 -> 值，附 _recordId） */
function openApiRowsToTable(
  rows: Array<{ record_id?: string; fields?: Record<string, unknown> }>,
): RecordTable {
  return {
    records: (rows ?? []).map((row) => ({
      _recordId: row.record_id ?? "",
      ...(row.fields ?? {}),
    })) as Array<Record<string, unknown> & { _recordId: string }>,
  };
}

function one(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) {
    if (value.length === 0) return "";
    const first = value[0];
    if (typeof first === "string") return first;
    if (first && typeof first === "object") {
      const obj = first as { text?: unknown; name?: unknown; value?: unknown };
      return String(obj.text ?? obj.name ?? obj.value ?? "");
    }
    return value.map(one).filter(Boolean).join(",");
  }
  if (typeof value === "object") {
    const obj = value as { text?: unknown; name?: unknown; value?: unknown };
    return String(obj.text ?? obj.name ?? obj.value ?? "");
  }
  return String(value);
}

function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(one).filter(Boolean);
  const single = one(value);
  return single ? [single] : [];
}

/** OpenAPI 关联字段：可能为 [{ record_ids: [...] }] 或 [{ id: ... }]。纯文本不是 link，返回空。 */
function linkIds(value: unknown): string[] {
  // 纯文本（如负责人姓名直接是纯文本字符串）不是 link 字段
  if (typeof value === "string") return [];
  const items = Array.isArray(value) ? value : value && typeof value === "object" ? [value] : [];
  const ids: string[] = [];
  for (const item of items) {
    if (item == null) continue;
    if (typeof item === "object") {
      const obj = item as { record_ids?: unknown; id?: unknown; record_id?: unknown };
      if (Array.isArray(obj.record_ids)) {
        ids.push(...obj.record_ids.map(String));
      } else if (obj.id != null) {
        ids.push(String(obj.id));
      } else if (obj.record_id != null) {
        ids.push(String(obj.record_id));
      }
    }
  }
  return ids.filter(Boolean);
}

function numberValue(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(one(value).replace("%", ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * 百分比文本归一化（取表值时用）：客户表里的进度/完成度可能是 0-1 小数(0.6)、0-100(60)、带%("60%")，
 * 统一转成「NN%」展示——0-1 视为比例 ×100，0-100 视为百分比原样，带%原样。
 */
function pctText(value: unknown): string {
  const s = String(value ?? "").trim();
  if (!s) return "0%";
  if (s.includes("%")) return s;
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  const pct = Math.round(n <= 1 ? n * 100 : n);
  return `${pct}%`;
}

/** OpenAPI 日期字段：毫秒时间戳数字或字符串，统一取 YYYY-MM-DD（按东八区，避免跨天偏差） */
function dateOnly(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    // 飞书日期按 UTC+8 存储：先加 8 小时再取 UTC 日期，任何服务器时区都得到东八区日期
    const d = new Date(value + 8 * 3600 * 1000);
    if (Number.isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 10);
  }
  const raw = one(value);
  if (!raw) return "";
  const match = raw.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (match) {
    const [, y, m, d] = match;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})T/);
  return iso ? iso[1] : raw.slice(0, 10);
}

/** 飞书公式可能返回电子表格日期序列号，如 47365；只在字段名明确是日期时转换。 */
function formulaDateSerialOnly(value: unknown, fieldName: string): string | null {
  if (!/日期|date/i.test(fieldName) || /剩余|天|有效期/i.test(fieldName)) return null;
  const n = numberValue(value);
  if (!Number.isFinite(n) || n < 20_000 || n > 80_000) return null;
  const utcDays = Math.round(n - 25569);
  const d = new Date(utcDays * 86_400_000);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function isDateFieldName(field: string) {
  return /日期|时间|期限|到期|过期|截止|签约|生效|跟进|沟通|回访|拜访|预约|续约|date|time|deadline|expire|due|signed|effective|follow|contact|visit|renew/i.test(field);
}

function isStatusFieldName(field: string) {
  return /状态|阶段|进度|结果|是否|status|stage|phase|state|result/i.test(field);
}

function isPersonFieldName(field: string) {
  return /负责人|责任人|成员|人员|参与人|协作人|执行人|处理人|指派人|经办人|跟进人|维护人|管理员|审批人|申请人|创建人|修改人|联系人|客户经理|销售|顾问|老师|user|owner|assignee|member|person|people|participant|handler|operator|contact|manager|sales/i.test(field);
}

function isIdentifierFieldName(field: string) {
  return /编号|编码|序号|单号|工号|手机号|手机|电话|座机|联系方式|邮箱|邮件|邮编|身份证|证件|id|code|no\.?|number|phone|mobile|tel|email|mail|zip|postal/i.test(field);
}

function looksDateLike(value: unknown): boolean {
  const text = one(value).trim();
  return /^\d{4}[/-]\d{1,2}[/-]\d{1,2}/.test(text) || /^\d{4}-\d{2}-\d{2}T/.test(text);
}

function looksNumericLike(value: unknown): boolean {
  const text = one(value).replace(/,/g, "").replace("%", "").trim();
  return text !== "" && Number.isFinite(Number(text));
}

function inferValueKind(field: string, valueSamples: unknown[], ft?: number): OfficeFieldKind | undefined {
  if (ft === 5 || valueSamples.some(looksDateLike) && isDateFieldName(field)) return "date";
  if (ft === 2) return "number";
  if (ft === 7) return "person";
  if (ft === 21) return "link";
  if (isPersonFieldName(field) && !isIdentifierFieldName(field)) return "person";
  if (ft === 3 || ft === 4) return isStatusFieldName(field) ? "status" : "group";
  if (isStatusFieldName(field)) {
    const values = valueSamples.map(one).map((v) => v.trim()).filter(Boolean);
    const distinct = new Set(values);
    if (values.length > 0 && distinct.size <= Math.max(15, Math.ceil(values.length * 0.7))) return "status";
  }
  if (isDateFieldName(field) && valueSamples.some(looksDateLike)) return "date";
  if (!isIdentifierFieldName(field) && valueSamples.length > 0 && valueSamples.filter(looksNumericLike).length / valueSamples.length >= 0.8) return "number";
  return undefined;
}

/** 写回日期：统一转成飞书 OpenAPI 接受的毫秒时间戳 */
function dateForWrite(value?: string): number | undefined {
  if (!value) return undefined;
  const iso = value.length === 10 ? `${value}T00:00:00+08:00` : value.replace(" ", "T");
  const ts = Date.parse(iso);
  return Number.isNaN(ts) ? undefined : ts;
}


/**
 * 统一字段读取（地基）：按飞书真实字段类型归一化值，确保任何字段格式都能读到、读得懂。
 * 返回 display（展示文本）+ values（用于计数/分布的字符串数组，多选/人员会展开）。
 * 覆盖：文本/数字/单选/多选/日期/人员/超链接/附件/关联/查找引用/公式/创建时间/创建人/按钮/分组/未识别。
 * 永不抛异常：未识别格式兜底为 JSON 字符串 + console.warn 标记，绝不因一个怪字段让面板白屏。
 */
function readFieldValue(
  value: unknown,
  fieldType: number | undefined,
  opts?: { fieldName?: string; percents?: string[] },
): { display: string; values: string[]; kind: string } {
  if (value == null) return { display: "", values: [], kind: "empty" };
  const ft = fieldType ?? 0;
  const fname = opts?.fieldName ?? "";
  try {
    if (ft === 4) {
      const arr = Array.isArray(value) ? value : [value];
      const vals = arr.map((v) => one(v)).filter(Boolean);
      return { display: vals.join("、"), values: vals, kind: "multiselect" };
    }
    if (ft === 7) {
      const arr = Array.isArray(value) ? value : [value];
      const names = arr
        .map((x) => {
          if (x && typeof x === "object") {
            const o = x as { name?: unknown; text?: unknown; en_name?: unknown };
            return String(o.name ?? o.text ?? o.en_name ?? "");
          }
          return String(x ?? "");
        })
        .filter(Boolean);
      return { display: names.join("、"), values: names, kind: "person" };
    }
    if (ft === 5 || ft === 22 || ft === 24 || ft === 1001 || ft === 1002) {
      const d = dateOnly(value);
      return { display: d, values: d ? [d] : [], kind: "date" };
    }
    if (ft === 2) {
      if (opts?.percents?.includes(fname)) {
        const pct = pctText(value);
        return { display: pct, values: [pct], kind: "percent" };
      }
      const n = numberValue(value);
      return { display: n.toLocaleString(), values: [String(n)], kind: "number" };
    }
    if (ft === 21 || ft === 18) {
      const ids = linkIds(value);
      return { display: ids.join("、"), values: ids, kind: "link" };
    }
    if (ft === 10 || ft === 15) {
      if (value && typeof value === "object") {
        const o = value as { text?: unknown; link?: unknown };
        return { display: String(o.text ?? o.link ?? ""), values: [String(o.text ?? o.link ?? "")], kind: "url" };
      }
      const s = one(value);
      return { display: s, values: s ? [s] : [], kind: "url" };
    }
    if (ft === 17 || ft === 11) {
      const arr = Array.isArray(value) ? value : value ? [value] : [];
      const names = arr
        .map((x) => {
          if (x && typeof x === "object") {
            const o = x as { name?: unknown; file_token?: unknown };
            return String(o.name ?? o.file_token ?? "");
          }
          return String(x ?? "");
        })
        .filter(Boolean);
      return {
        display: names.length > 0 ? `${names.length}个附件：${names.slice(0, 3).join("、")}${names.length > 3 ? "…" : ""}` : "",
        values: names,
        kind: "attachment",
      };
    }
    const single = one(value);
    return { display: single, values: single ? [single] : [], kind: ft === 3 ? "select" : "text" };
  } catch (e) {
    const fallback = typeof value === "object" ? JSON.stringify(value) : String(value);
    console.warn(`[readFieldValue] 未识别格式 field=${fname} type=${ft}:`, fallback.slice(0, 120));
    return { display: fallback, values: [fallback], kind: "unknown" };
  }
}

async function recordList(tableId: string, limit = 200): Promise<RecordTable> {
  // 本地模式：直接走 lark-cli（客户扫码授权身份），无需 token
  const { rows } = await recordListRaw(BASE_TOKEN, tableId, limit);
  return openApiRowsToTable(rows.map((r) => ({ record_id: r._recordId, fields: { ...r } })));
}

/** 字段类型缓存：表 id -> { types, options }（5 分钟有效） */
const fieldMetaCache = new Map<
  string,
  { types: Record<string, number>; options: Record<string, string[]>; percents: string[]; links: Record<string, { tableId: string; tableName: string }>; at: number }
>();
const FIELD_META_CACHE_MS = 8_000;

/** 只读列（飞书服务端计算，页面无法写回）：lookup/formula/rollup/auto_number/button/group/创建人/修改人等。
 *  lark-bridge 统一映射为 openApiType=90；页面据此拒绝把这类列当作写回目标（负责人/状态/项目/表单字段）。 */
const READONLY_TYPE_CODES = new Set<number>([90]);

/**
 * 读取一张表的字段真实类型 + select 选项（OpenAPI 字段接口）。
 * 类型映射：1=Text 2=Number 3=SingleSelect 4=MultiSelect 5=DateTime 7=人员 11=公式...
 * 写回时按此类型转换、表单按此渲染控件（下拉/日期/数字/多选/关联），全程与客户表一致，不靠猜。
 */
async function getTableFieldMeta(tableId: string): Promise<{
  types: Record<string, number>;
  options: Record<string, string[]>;
  percents: string[];
  links: Record<string, { tableId: string; tableName: string }>;
}> {
  const cached = fieldMetaCache.get(tableId);
  if (cached && Date.now() - cached.at < FIELD_META_CACHE_MS) return cached;
  // 本地模式：lark-cli field-list 返回完整元数据（类型/选项/百分比/关联表）
  const metas = await fieldList(BASE_TOKEN, tableId);
  const types: Record<string, number> = {};
  const options: Record<string, string[]> = {};
  const percents: string[] = [];
  const links: Record<string, { tableId: string; tableName: string }> = {};
  for (const f of metas) {
    types[f.name] = f.openApiType;
    if (f.options.length > 0) options[f.name] = f.options;
    if (f.percent) percents.push(f.name);
    if (f.linkTableId) links[f.name] = { tableId: f.linkTableId, tableName: f.linkTableName };
  }
  fieldMetaCache.set(tableId, { types, options, percents, links, at: Date.now() });
  return { types, options, percents, links };
}

/**
 * 写回值按字段类型转换：Number→数字、DateTime→时间戳、Select→选项文本、MultiSelect→数组、Link→recordId 数组、Text→原样。
 * 百分比字段（formatter 含 %）：前端按 0-100 填，这里转 0-1（如 60 → 0.6）。
 */
function coerceFieldValue(
  fieldName: string,
  rawValue: unknown,
  fieldTypes: Record<string, number>,
  percents: string[] = [],
): unknown {
  const ft = fieldTypes[fieldName];
  if (ft === 21) {
    // 关联字段：写 [recordId]（前端已选 recordId 或 recordId 数组）
    if (Array.isArray(rawValue)) return rawValue;
    const s = String(rawValue ?? "").trim();
    return s ? [s] : undefined;
  }
  if (ft === 4) {
    // 多选字段：写字符串数组（前端提交的数组或逗号/顿号分隔文本都转数组）
    if (Array.isArray(rawValue)) return rawValue.map((x) => String(x).trim()).filter(Boolean);
    const s = String(rawValue ?? "").trim();
    if (!s) return undefined;
    const parts = s.split(/[,，、;；\s]+/).map((x) => x.trim()).filter(Boolean);
    return parts.length > 0 ? parts : [s];
  }
  const v = String(rawValue ?? "").trim();
  if (v === "") return undefined;
  if (ft === 2) {
    // 百分比字段（formatter 含 %）：0-100 → 0-1；普通数字：直接转数字
    const n = Number(v);
    if (Number.isFinite(n)) {
      if (percents.includes(fieldName)) {
        const abs = Math.abs(n);
        return abs > 1 ? abs / 100 : abs; // 填 60 → 0.6；填 0.6 也兼容
      }
      return n;
    }
    return rawValue;
  }
  if (ft === 5) {
    // DateTime：YYYY-MM-DD 或时间戳字符串 → 毫秒时间戳
    const ts = dateForWrite(v);
    return ts ?? rawValue;
  }
  // Text / Select / 其他：原样文本
  return v;
}

function isEmptyWriteValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  return String(value).trim() === "";
}

function writtenFieldMatches(
  fieldName: string,
  expected: unknown,
  actual: unknown,
  fieldTypes: Record<string, number>,
): boolean {
  const ft = fieldTypes[fieldName];
  if (ft === 21 || ft === 7) {
    const expectedIds = Array.isArray(expected) ? expected.map(String) : [String(expected ?? "")];
    const actualIds = linkIds(actual);
    return expectedIds.filter(Boolean).every((id) => actualIds.includes(id));
  }
  if (ft === 4) {
    const expectedValues = Array.isArray(expected) ? expected.map(String) : list(expected);
    const actualValues = list(actual);
    return expectedValues.filter(Boolean).every((value) => actualValues.includes(value));
  }
  if (ft === 5) {
    const expectedDate = dateOnly(expected);
    const actualDate = dateOnly(actual);
    return !!expectedDate && expectedDate === actualDate;
  }
  if (ft === 2) {
    const expectedNumber = Number(expected);
    const actualNumber = numberValue(actual);
    return Number.isFinite(expectedNumber) && Math.abs(expectedNumber - actualNumber) < 0.000001;
  }
  return one(actual) === String(expected ?? "");
}

/** 取状态字段默认值：优先"待办/未开始"（若有），否则取第一个选项（保证在选项里，不报错） */
function getFirstStatusOption(
  fieldTypes: Record<string, number>,
  fieldOptions: Record<string, string[]>,
): string {
  const statusField = FIELDS.tasks.status;
  const opts = fieldOptions[statusField] ?? [];
  if (opts.length === 0) return "待办";
  const preferred = ["待办", "未开始", "未启动", "待处理"].find((p) => opts.includes(p));
  return preferred ?? opts[0];
}

/**
 * 选项字段值校验：值必须在客户表真实选项里（精确或忽略空格/大小写后模糊匹配）。
 * 返回匹配到的选项文本；匹配不到返回 null（调用方决定丢弃该字段并给用户明确提示）。
 */
function matchOption(fieldOptions: Record<string, string[]>, field: string, value: string): string | null {
  const opts = fieldOptions[field];
  if (!opts || opts.length === 0) return value; // 无选项信息（如文本字段），原样返回
  const exact = opts.find((o) => o === value);
  if (exact) return exact;
  const norm = (s: string) => s.trim().replace(/[ 　]/g, "").toLowerCase();
  const fuzzy = opts.find((o) => norm(o) === norm(value));
  return fuzzy ?? null;
}

/** 读回单条记录（read-back 校验用） */
async function recordGet(
  tableId: string,
  recordId: string,
): Promise<Record<string, unknown> & { _recordId: string }> {
  const row = await recordGetRaw(BASE_TOKEN, tableId, recordId);
  return row ?? { _recordId: recordId };
}

function toMember(row: Record<string, unknown> & { _recordId: string }): OfficeMember {
  return {
    id: row._recordId,
    name: one(row[FIELDS.members.name]) || "未命名成员",
    employeeNo: one(row[FIELDS.members.employeeNo]),
    role: one(row[FIELDS.members.role]) || "成员",
    level: one(row[FIELDS.members.level]),
    skills: list(row[FIELDS.members.skills]),
    totalTasks: numberValue(row[FIELDS.members.total]),
    todoTasks: numberValue(row[FIELDS.members.todo]),
    activeTasks: numberValue(row[FIELDS.members.active]),
    doneTasks: numberValue(row[FIELDS.members.done]),
    overdueTasks: numberValue(row[FIELDS.members.overdue]),
    completion: one(row[FIELDS.members.completion]) || "0%",
  };
}

/** 主入口表运行时语义（画像驱动）：配置确认的字段优先，缺失按画像/类型自动识别 */
type MainSemantics = {
  name?: string;
  owner?: string;
  status?: string;
  due?: string;
  priority?: string;
  type?: string;
  project?: string;
  description?: string;
  remark?: string;
  overdue?: string;
  remain?: string;
  /** 画像推断的状态/短分类列（值分布驱动，不靠列名） */
  lifeCycle?: string[];
  /** 业务日期候选列（排除创建/更新时间），供展示层按上下文取用 */
  dueCandidates?: string[];
  /** 画像推断的人员列候选 */
  personCandidates?: string[];
  /** 画像推断的百分比/完成度列候选 */
  percentCandidates?: string[];
  /** 画像推断的只读列（formula/lookup/auto_number 等），写回必须跳过 */
  readonlyFields?: string[];
};

function toTask(
  row: Record<string, unknown> & { _recordId: string },
  memberNameById: Map<string, string>,
  S: MainSemantics,
  completionField?: string,
): OfficeTask {
  const status = one(S.status ? row[S.status] : undefined) || "";
  const overdueText = one(S.overdue ? row[S.overdue] : undefined);
  // 超期判定①：状态/公式字段含"超期"（兼容已有公式字段的表）
  const isOverdueStatus = ["已延期", "延期", "超期", "已超期", "Overdue"].some((k) => status.includes(k));
  // 已关闭/已归还类记录：不再用截止日期反推"超期"（历史事实日期不输出风险结论）
  const closedStatus = /已归还|已完成|已结束|已办结|已交付|已关闭|已完|完成|Closed|Done|Returned/i.test(status);
  const dueDate = dateOnly(S.due ? row[S.due] : undefined);
  // 超期判定②：用截止/跟进日期自己算（任何表都准，不依赖公式字段）
  //   今天 > 日期 = 已到/超期；今天到日期 ≤3 天 = 临期；已关闭/已归还的记录不计算
  let remainingText = "";
  let overdue = isOverdueStatus || overdueText.includes("超期");
  let dueSoon = false;
  if (dueDate && !closedStatus) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(`${dueDate}T00:00:00`);
    const diffDays = Math.round((due.getTime() - today.getTime()) / 86_400_000);
    if (!overdue && diffDays < 0) {
      overdue = true;
      remainingText = `超期${Math.abs(diffDays)}天`;
    } else if (diffDays >= 0 && diffDays <= 3) {
      dueSoon = true;
      remainingText = `剩${diffDays}天`;
    }
  }
  if (!remainingText) remainingText = one(S.remain ? row[S.remain] : undefined) || "";
  // 负责人解析（兼容所有形态）：user 字段 [{id,name}] 取姓名；文本取文本；link 字段取关联成员名
  // 关键：值里带 name/text 就优先用姓名（不再误判成关联字段）
  const ownerRaw = S.owner ? row[S.owner] : undefined;
  const ownerIds = linkIds(ownerRaw);
  const namedParts = Array.isArray(ownerRaw)
    ? ownerRaw
        .map((x) => (x && typeof x === "object" ? String(x.name || x.text || "") : String(x ?? "")))
        .filter(Boolean)
    : (() => {
        const t = one(ownerRaw);
        return t ? [t] : [];
      })();
  const ownerName =
    namedParts.length > 0
      ? namedParts.join("、")
      : ownerIds.map((id) => memberNameById.get(id)).filter(Boolean).join("、");
  // 终态判定：不预设词表。表里有状态列就取真实值，由展示层按真实状态值分组；
  // 没有可靠终态判定时 done=false（不把已成交/已签约等业务词硬塞进完成）。
  const done = false;
  // 回款/收款类生命周期列的真实值（如"已回款/部分回款/未回款"）：用于特别关注的催收判定。
  // 表里没有回款列则为 undefined（不预设词，按列名含 回款/收款/pay 识别）。
  const paymentField = (S.lifeCycle ?? []).find((col) => /回款|收款|pay|payment/i.test(col));
  const payment = paymentField ? one(row[paymentField]) : undefined;
  return {
    id: row._recordId,
    title: one(S.name ? row[S.name] : undefined) || "",
    owner: ownerName,
    status,
    priority: one(S.priority ? row[S.priority] : undefined) || "",
    type: one(S.type ? row[S.type] : undefined) || "",
    dueDate,
    remainingText,
    overdue,
    dueSoon,
    // 项目兼容 link（ID）与文本（名称）两种；文本时直接用文本作为 projectId 供展示
    projectId: S.project ? linkIds(row[S.project])[0] || one(row[S.project]) || undefined : undefined,
    milestoneIds: [],
    description: one(S.description ? row[S.description] : undefined),
    // 完成度：表里有完成度/进度列就实时读（0-1 或 0-100 都归一）；没有则为 0
    completion: completionField ? numberValue(row[completionField]) : 0,
    done,
    payment,
    rawFields: Object.fromEntries(Object.entries(row).filter(([key]) => key !== "_recordId")),
  };
}

/**
 * 主入口表语义解析：画像驱动（认数据不认词）。
 * 优先顺序：① 配置里用户确认的字段（写回必须精确）② 画像推断的语义（真实数据：类型/去重/样本值）③ 类型兜底。
 * 不再用列名词表猜测——列名千奇百怪，词表永远有盲区；画像看真实数据，语义由数据自己显现。
 */
function resolveMainSemantics(
  tFields: string[],
  tTypes: Record<string, number>,
  tOptions: Record<string, string[]>,
  profiles?: FieldProfile[],
): MainSemantics {
  const selCols = tFields.filter((f) => tTypes[f] === 3 || tTypes[f] === 4); // 选项列
  const dateCols = tFields.filter((f) => tTypes[f] === 5); // 日期列
  const userCols = tFields.filter((f) => tTypes[f] === 7); // 人员列
  const linkCols = tFields.filter((f) => tTypes[f] === 21); // 关联列
  const textCols = tFields.filter((f) => tTypes[f] === 1); // 文本列
  const cfg = (key: keyof MainSemantics) => FIELDS.tasks[key];
  const inTable = (name?: string) => name && tFields.includes(name);

  // 画像推断的语义（如有）：每列 → semantic
  const semanticByName = new Map<string, SemanticField>();
  if (profiles && profiles.length > 0) {
    const inferred = inferTableSemantics({
      tableId: "",
      tableName: "",
      recordCount: 0,
      hasMore: false,
      fields: profiles,
    });
    for (const s of inferred) semanticByName.set(s.field, s);
  }
  const sem = (name?: string) => (name ? semanticByName.get(name)?.semantic : undefined);
  // 画像语义：人员/状态/百分比/日期/只读/关联
  const personsBySem = tFields.filter((f) => sem(f) === "person");
  const statusBySem = tFields.filter((f) => sem(f) === "status");
  const percentBySem = tFields.filter((f) => sem(f) === "percent");
  const dateBySem = tFields.filter((f) => sem(f) === "datetime");
  const inferredDateCols = profiles
    ? profiles
        .filter((profile) => isDateFieldName(profile.field) && profile.topValues.some((v) => looksDateLike(v.value)))
        .map((profile) => profile.field)
    : [];
  const inferredStatusCols = profiles
    ? profiles
        .filter((profile) => isStatusFieldName(profile.field) && profile.topValues.length > 0 && profile.distinctCount <= Math.max(15, Math.ceil(profile.nonNull * 0.7)))
        .map((profile) => profile.field)
    : [];
  const linkBySem = tFields.filter((f) => sem(f) === "link");
  const readonlyBySem = tFields.filter((f) => sem(f) === "readonly" || sem(f) === "id");

  // 状态主列：配置确认的优先；否则画像 status 列中「值含状态词」且唯一时选（与 deliver 同规则）。
  // 状态词=已/未/中/待/暂停/阻塞/延期/完成/结束/规划/筹备（"当前状态"非"流程步骤"）；
  // 多个都含状态词（客户状态/回款状态）→ 不选，页面展示全部状态列分布（真实，不猜）。
  const configuredStatus = inTable(cfg("status")) ? cfg("status") : undefined;
  const statusWords = /已|未|中|待|暂停|阻塞|延期|完成|结束|规划|筹备|Done|Doing|Todo|Closed|Pending|Active|In Progress/i;
  const priorityLike = (t: string) => /^[PSABC]\d|^\d+[级类]|P0|P1|P2|P3|紧急|高|中|低/i.test(t);
  const statusByWord = [...new Set([...statusBySem, ...inferredStatusCols])].filter((f) => {
    const top = profiles?.find((p) => p.field === f)?.topValues ?? [];
    if (top.length > 0 && top.every((t) => priorityLike(t.value))) return false;
    return top.some((t) => statusWords.test(t.value));
  });
  const status = configuredStatus || (statusByWord.length === 1 ? statusByWord[0] : undefined);

  // 截止日期：只认配置确认的字段；没有则不识别（页面不产生超期）。
  // 画像的 datetime 列全部保留为候选（dueCandidates），由展示层按类型展示，不做"哪个是截止"的猜测。
  const configuredDue = inTable(cfg("due")) ? cfg("due") : undefined;
  const dateCandidates = [...new Set([...dateBySem, ...dateCols, ...inferredDateCols])]
    .filter((f) => !/创建|更新|建档|录入|modified|created|updated/i.test(f))
    .sort((a, b) => {
      const score = (name: string) =>
        /下次|跟进|沟通|回访|拜访|预约|提醒|续约|到期|过期|截止|deadline|expire|due|follow|contact|visit|renew/i.test(name) ? 100 :
        /签约|生效|开始|完成|交付|上线|signed|effective|start|finish|complete|launch/i.test(name) ? 60 : 20;
      return score(b) - score(a);
    });
  const due = configuredDue || dateCandidates[0];
  // 业务日期候选（排除 meta/created_at/updated_at）：展示层按类型展示，不猜哪个是截止
  const dueCandidates = dateCandidates;

  return {
    // 名称/负责人：配置确认的优先；画像明确识别为 person 的列兜底；都没有 → undefined（页面隐藏，绝不随便取文本列当名称）
    name: inTable(cfg("name")) ? cfg("name") : undefined,
    owner: inTable(cfg("owner")) ? cfg("owner") : personsBySem[0] || undefined,
    status,
    due,
    priority: inTable(cfg("priority")) ? cfg("priority") : undefined,
    type: inTable(cfg("type")) ? cfg("type") : undefined,
    // 项目：只认配置确认的；没有 → 画像 link 列第一个（关联列就是"指向别的记录"，可当分组依据）；都没有 → undefined
    project: inTable(cfg("project")) ? cfg("project") : linkBySem[0] || undefined,
    description: inTable(cfg("description")) ? cfg("description") : undefined,
    remark: inTable(cfg("remark")) ? cfg("remark") : undefined,
    overdue: inTable(cfg("overdue")) ? cfg("overdue") : undefined,
    remain: inTable(cfg("remain")) ? cfg("remain") : undefined,
    // 画像语义补充：页面按需取用（不强制写回）
    lifeCycle: [...new Set([...statusBySem, ...inferredStatusCols])],
    dueCandidates,
    personCandidates: personsBySem,
    percentCandidates: percentBySem,
    readonlyFields: readonlyBySem,
  };
}

function toProject(row: Record<string, unknown> & { _recordId: string }): OfficeProject {
  return {
    id: row._recordId,
    name: one(row[FIELDS.projects.name]) || "未命名项目",
    status: one(row[FIELDS.projects.status]),
    priority: one(row[FIELDS.projects.priority]) || "P3 低",
    progress: one(row[FIELDS.projects.progress]) || "0%",
    members: list(row[FIELDS.projects.members]),
    totalTasks: numberValue(row[FIELDS.projects.totalTasks]),
    riskCount: numberValue(row[FIELDS.projects.riskCount]),
    dueDate: dateOnly(row[FIELDS.projects.dueDate]),
  };
}

function toRisk(row: Record<string, unknown> & { _recordId: string }): OfficeRisk {
  return {
    id: row._recordId,
    title: one(row[FIELDS.risks.title]) || "未命名风险",
    owner: one(row[FIELDS.risks.owner]) || "未分配",
    level: one(row[FIELDS.risks.level]) || "中",
    status: one(row[FIELDS.risks.status]) || "待处理",
    dueDate: dateOnly(row[FIELDS.risks.due]),
    action: one(row[FIELDS.risks.action]),
    projectId: linkIds(row[FIELDS.risks.project])[0],
    taskIds: linkIds(row[FIELDS.risks.task]),
  };
}

function toMilestone(row: Record<string, unknown> & { _recordId: string }): OfficeMilestone {
  return {
    id: row._recordId,
    name: one(row[FIELDS.milestones.name]) || "未命名里程碑",
    owner: one(row[FIELDS.milestones.owner]) || "未分配",
    status: one(row[FIELDS.milestones.status]) || "未开始",
    dueDate: dateOnly(row[FIELDS.milestones.due]),
    actualDate: dateOnly(row[FIELDS.milestones.actual]),
    deliverable: one(row[FIELDS.milestones.deliverable]),
    projectId: linkIds(row[FIELDS.milestones.project])[0],
    taskIds: linkIds(row[FIELDS.milestones.task]),
  };
}

function ownerIncludes(task: OfficeTask, name: string): boolean {
  if (!task.owner || !name) return false;
  if (task.owner === name) return true;
  const target = personComparableName(name);
  return task.owner.split(/[、,，;；]/).some((part) => {
    const clean = part.trim();
    return clean === name || (target !== "" && personComparableName(clean) === target);
  });
}

function findMemberByComparableName(name: string, members: OfficeMember[]) {
  const exact = members.find((member) => member.name === name);
  if (exact) return exact;
  const target = personComparableName(name);
  const matches = members.filter((member) => target && personComparableName(member.name) === target);
  return matches.length === 1 ? matches[0] : undefined;
}

function splitPersonText(value: unknown): string[] {
  return fieldValueText(value)
    .split(/[、,，;；\n]/)
    .map((part) => part.trim())
    .filter((part) =>
      part !== "" &&
      !/^已关联\s*\d+\s*条$/.test(part) &&
      !/^rec[a-zA-Z0-9]{8,}$/.test(part) &&
      !/^\d+$/.test(part) &&
      !/^\d{4}-\d{2}-\d{2}$/.test(part) &&
      part.length <= 40,
    );
}

function addCanonicalName(names: Map<string, string>, rawName: string): string | undefined {
  const name = rawName.trim();
  if (!name) return undefined;
  const target = personComparableName(name);
  for (const existing of names.keys()) {
    if (existing === name) return existing;
    if (target && personComparableName(existing) === target) return existing;
  }
  names.set(name, name);
  return name;
}

async function fetchOfficeSnapshotFresh(version = snapshotVersion): Promise<OfficeSnapshot> {
  try {
    // 同一张表在一次快照里只读一次（wave1 与 tables 循环共用缓存），避免重复读表拖慢快照
    const rowCache = new Map<string, RecordTable>();
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const safeList = async (tableId: string | undefined): Promise<RecordTable> => {
      if (!tableId) return { records: [] };
      if (!rowCache.has(tableId)) {
        let lastError: unknown;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            rowCache.set(tableId, await recordList(tableId));
            break;
          } catch (error) {
            lastError = error;
            const message = error instanceof Error ? error.message : String(error);
            if (!/800050828|800004135|fine-grained rate limiting|rate limit|limited|限流/i.test(message)) throw error; // 匹配限流语义：覆盖多种飞书限流错误码，不因只认单一码而误降级
            await wait(1500 * (attempt + 1));
          }
        }
        if (!rowCache.has(tableId)) throw lastError;
      }
      return rowCache.get(tableId) ?? { records: [] };
    };
    // 并行读表：串行 5 张表约 5-10s，并行降到 ~2s，避免轮询积压 + 高频占用飞书接口
    const [memberRows, taskRows, projectRows, riskRows, milestoneRows] = await Promise.all([
      safeList(TBL.members),
      safeList(TBL.tasks),
      safeList(TBL.projects),
      safeList(TBL.risks),
      safeList(TBL.milestones),
    ]);

    // 关联字段 → 被关联记录名称（通用视图不显示原始 record ID）
    const linkNames = async (tableId: string, value: unknown): Promise<string> => {
      const rows = await safeList(tableId);
      const def = OFFICE_CONFIG.tables.find((d) => d.id === tableId);
      const nameField = def?.fields?.name;
      const names = linkIds(value)
        .map((id) => {
          const row = rows.records.find((r) => r._recordId === id);
          if (!row) return "";
          return nameField ? one(row[nameField]) : "";
        })
        .filter(Boolean);
      if (names.length > 0) return names.join("、");
      const count = linkIds(value).length;
      return count > 0 ? `已关联 ${count} 条` : fieldValueText(value);
    };

    const memberRowsParsed = memberRows.records.map(toMember);
    const memberNameById = new Map(memberRowsParsed.map((member) => [member.id, member.name]));
    const rawProjects = projectRows.records.map(toProject);
    const projectById = new Map(rawProjects.map((project) => [project.id, project.name]));
    // 项目名按名称匹配（兼容任务表项目字段为文本的场景）
    const projectByName = new Map(rawProjects.map((project) => [project.name, project.id]));
    const resolveProjectName = (projectId?: string) => {
      if (!projectId) return undefined;
      const byId = projectById.get(projectId);
      if (byId) return byId;
      const byName = projectByName.get(projectId);
      return byName ? projectId : undefined;
    };
    // 主入口表语义（画像驱动）：用真实数据构建字段画像（类型/去重/样本值），语义由数据自己显现
    const tasksFieldMeta = await getTableFieldMeta(TBL.tasks).catch(() => null);
    const taskFieldNames = Array.from(
      new Set(taskRows.records.flatMap((r) => Object.keys(r).filter((k) => k !== "_recordId"))),
    );
    const taskProfiles: FieldProfile[] = taskFieldNames.map((fname) => {
      const values = taskRows.records
        .map((r) => one(r[fname]))
        .filter((v) => v !== "");
      const distinct = new Map<string, number>();
      for (const v of values) distinct.set(String(v), (distinct.get(String(v)) || 0) + 1);
      const topValues = [...distinct.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([value, count]) => ({ value, count }));
      const ft = tasksFieldMeta?.types[fname];
      const profile: FieldProfile = {
        field: fname,
        type: ft === 1 ? "text" : ft === 2 ? "number" : ft === 3 ? "select" : ft === 5 ? "datetime" : ft === 7 ? "user" : ft === 21 ? "link" : "text",
        nullRate: taskRows.records.length > 0 ? (taskRows.records.length - values.length) / taskRows.records.length : 0,
        nonNull: values.length,
        distinctCount: distinct.size,
        topValues,
      };
      if (ft === 2) {
        const nums = values.map(Number).filter((n) => Number.isFinite(n));
        if (nums.length) {
          profile.number = {
            min: Math.min(...nums),
            max: Math.max(...nums),
            avg: Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(3)),
          };
        }
      }
      if (ft === 5) {
        const dates = values.map((s) => (s.match(/^\d{4}-\d{2}-\d{2}/) || [""])[0]).filter(Boolean);
        if (dates.length) {
          const sorted = [...dates].sort();
          profile.date = { min: sorted[0], max: sorted[sorted.length - 1] };
        }
      }
      return profile;
    });
    const mainS = resolveMainSemantics(taskFieldNames, tasksFieldMeta?.types ?? {}, tasksFieldMeta?.options ?? {}, taskProfiles);
    // 完成度列：配置确认的优先；否则画像 percent 候选第一个（0~1 数字，值分布驱动）；否则 undefined
    const completionField = FIELDS.tasks.completion || mainS.percentCandidates?.[0];
    const tasks = taskRows.records
      .map((row) => toTask(row, memberNameById, mainS, completionField))
      .map((task) => ({
        ...task,
        projectName: resolveProjectName(task.projectId),
      }));
    // 事项名称字段是关联字段（link）：解析为被关联记录的可读名称，避免标题为空。
    // 名称目标表可能不在主入口/档案/项目角色中（仅作 data 表），
    // 只要配置里给该表映射了 name 字段即可解析。
    const tasksNameField = FIELDS.tasks.name;
    const tasksNameLinkTarget = tasksFieldMeta?.links?.[tasksNameField]?.tableId;
    if (tasksNameLinkTarget && tasksNameLinkTarget !== TBL.tasks) {
      const linkedNameDef = OFFICE_CONFIG.tables.find((t) => t.id === tasksNameLinkTarget);
      const linkedNameField = linkedNameDef?.fields?.name;
      if (linkedNameField) {
        const linkedRows = await safeList(tasksNameLinkTarget);
        const idToName = new Map(linkedRows.records.map((r) => [r._recordId, one(r[linkedNameField])]));
        for (const task of tasks) {
          if (!task.title) {
            const ids = linkIds(task.rawFields?.[tasksNameField]);
            if (ids.length) {
              const resolved = ids.map((id) => idToName.get(id)).filter(Boolean).join("、");
              if (resolved) task.title = resolved;
            }
          }
        }
      }
    }

    // 完成度平均（0-1 或 0-100 都归一为百分比）：任务表有完成度列时用它算进度
    const completionPct = (mine: OfficeTask[]) => {
      const vals = mine.filter((t) => t.completion && t.completion > 0).map((t) => t.completion ?? 0);
      if (vals.length === 0) return 0;
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      return Math.round(avg <= 1 ? avg * 100 : avg);
    };
    // 项目进度：表格有「进度」列就取表格值；否则任务表有完成度列 → 完成度平均；再否则按已完成/总数
    const projectStats = new Map<string, { done: number; total: number }>();
    for (const t of tasks) {
      const key = t.projectName || "";
      if (!key) continue;
      const s = projectStats.get(key) ?? { done: 0, total: 0 };
      s.total += 1;
      // done 计数已移除：不预设终态词表，不再用 done/total 自造进度
      projectStats.set(key, s);
    }
    const hasTableProgress = Boolean(FIELDS.projects.progress);
    const projects = rawProjects.map((p) => {
      const s = projectStats.get(p.name);
      let computedPct = 0;
      if (completionField) {
        computedPct = completionPct(tasks.filter((t) => t.projectName === p.name));
      } else if (s && s.total > 0) {
        computedPct = Math.round((s.done / s.total) * 100);
      }
      return {
        ...p,
        // 表有值取表、没有才计算：进度与任务数都是这条规则；每次快照重建都实时重算
        progress: hasTableProgress ? pctText(p.progress) : completionField ? (computedPct > 0 ? `${computedPct}%` : "0%") : "",
        totalTasks: FIELDS.projects.totalTasks ? p.totalTasks : (s?.total ?? 0),
      };
    });

    // ── 通用化核心：读所有表、所有字段，用【飞书真实字段类型】标注语义（不靠猜）──
    const allTableDefs = OFFICE_CONFIG.tables;
    const tables: OfficeTable[] = await Promise.all(
      allTableDefs.map(async (def) => {
        const [rows, fieldMeta] = await Promise.all([
          safeList(def.id),
          // 并行拿字段真实类型 + select 选项（OpenAPI 字段接口，不靠数据特征猜）
          getTableFieldMeta(def.id).catch(() => ({ types: {} as Record<string, number>, options: {} as Record<string, string[]>, percents: [] as string[], links: {} as Record<string, { tableId: string; tableName: string }> })),
        ]);
        const fieldTypes: Record<string, number> = fieldMeta.types;
        const fieldOptions: Record<string, string[]> = fieldMeta.options;
        const fieldPercents: string[] = fieldMeta.percents ?? [];
        const fieldLinks: Record<string, { tableId: string; tableName: string }> = fieldMeta.links ?? {};
        // 字段语义：优先用 deliver.mjs 标注的 fields 映射；其余按飞书真实类型判断
        const fieldKinds: Record<string, OfficeFieldKind> = {};
        const semanticToKind: Record<string, OfficeFieldKind> = {
          name: "name",
          owner: "person",
          status: "status",
          due: "date",
          start: "date",
          doneDate: "date",
          project: "group",
          priority: "text",
          type: "text",
          description: "text",
          remark: "text",
          count: "number",
          stage: "text",
          importance: "text",
        };
        // 收集该表出现的所有字段名（从配置映射 + 记录里的键）
        const allFieldNames = new Set<string>();
        for (const f of Object.keys(def.fields)) allFieldNames.add(def.fields[f]);
        for (const r of rows.records) for (const k of Object.keys(r)) if (k !== "_recordId") allFieldNames.add(k);
        for (const fname of allFieldNames) {
          // 配置里标注了语义的：直接映射
          const semantic = Object.entries(def.fields).find(([, v]) => v === fname)?.[0];
          if (semantic && semanticToKind[semantic]) {
            fieldKinds[fname] = semanticToKind[semantic];
            continue;
          }
          // 未配置语义的：按飞书真实字段类型判断（5=DateTime 2=Number 3/4=Select 7=人员 21=关联 1/11/其他=text）
          const ft = fieldTypes[fname];
          const samples = rows.records.map((record) => record[fname]).filter((value) => one(value).trim() !== "");
          fieldKinds[fname] = inferValueKind(fname, samples, ft) ?? "text";
        }
        return {
          id: def.id,
          title: def.title || def.role,
          role: def.role,
          fieldKinds,
          // 飞书真实字段类型 + select 选项（写回时按类型转换、表单渲染下拉选项）
          fieldTypes,
          fieldOptions,
          fieldPercents,
          fieldLinks,
          records: await Promise.all(
            rows.records.map(async (r) => ({
              id: r._recordId,
              fields: Object.fromEntries(
                await Promise.all(
                  Object.entries(r)
                    .filter(([k]) => k !== "_recordId")
                    .map(async ([k, v]) => {
                      // date 类字段统一转 YYYY-MM-DD（毫秒时间戳/字符串都转），不显示原始时间戳
                      if (fieldKinds[k] === "date") return [k, dateOnly(v)];
                      // 关联字段：解析为被关联记录的名称（不显示原始 record ID）。
                      // 注意：用户确认的负责人字段也可能是 link（如“合同客户”），即使语义标成 person，也必须展开。
                      if (fieldKinds[k] === "link" || fieldTypes[k] === 21) {
                        const target = fieldLinks[k]?.tableId;
                        if (target && target !== def.id) return [k, await linkNames(target, v)];
                        return [k, fieldValueText(v)];
                      }
                      // 百分比数字（formatter 带 %）：归一化为 NN%（不显示 0.142857143）
                      if (fieldKinds[k] === "number" && fieldPercents.includes(k)) return [k, pctText(v)];
                      const formulaDate = formulaDateSerialOnly(v, k);
                      if (formulaDate) return [k, formulaDate];
                      return [k, v];
                    }),
                ),
              ),
            })),
          ),
        };
      }),
    );

    // 成员统计：不预设词表分类。totalTasks=该成员任务数；statusDist=真实状态值分布（核心）；
    // todo/active/done 不再用词表猜，统一为 0（展示层改用 statusDist 真实值）。
    const statFor = (name: string) => {
      const mine = tasks.filter((t) => ownerIncludes(t, name));
      const dist = new Map<string, number>();
      for (const t of mine) {
        const v = t.status.trim();
        if (v) dist.set(v, (dist.get(v) || 0) + 1);
      }
      return {
        totalTasks: mine.length,
        todoTasks: 0,
        activeTasks: 0,
        doneTasks: 0,
        overdueTasks: mine.filter((t) => t.overdue).length,
        statusDist: [...dist.entries()].map(([value, count]) => ({ value, count })),
      };
    };
    let members: OfficeMember[];
    // 成员完成度：成员表有完成度列→取表的；任务表有完成度列→该成员任务完成度平均；否则按已完成/总数
    const memberCompletion = (name: string): string => {
      if (completionField) {
        const pct = completionPct(tasks.filter((t) => ownerIncludes(t, name)));
        return pct > 0 ? `${pct}%` : "0%";
      }
      return "";
    };
    // 全局成员池：全表人员关系 + 人员档案表 + 管理员，合并去重。
    // 主入口表只决定默认交互和写回入口；全量分析不能只看主入口负责人。
    // 纯档案人员保留在 snapshot.members；座位由 activeMembers 按相关事项数筛选。
    const nameSet = new Map<string, string>();
    const relatedRecordCount = new Map<string, number>();
    const addRelated = (rawName: string) => {
      const canonical = addCanonicalName(nameSet, rawName);
      if (!canonical) return;
      relatedRecordCount.set(canonical, (relatedRecordCount.get(canonical) ?? 0) + 1);
    };
    const memberProfileByName = new Map<string, OfficeMember>();
    if (TBL.members) {
      for (const row of memberRows.records) {
        const profile = toMember(row);
        const nm = profile.name.trim();
        if (nm && nm !== "未命名成员") {
          if (!memberProfileByName.has(nm)) memberProfileByName.set(nm, profile);
          addCanonicalName(nameSet, nm);
        }
      }
    }
    for (const table of tables) {
      const personFields = Object.entries(table.fieldKinds)
        .filter(([field, kind]) => {
          if (table.role === "members" && field === FIELDS.members.name) return false;
          if (kind === "person") return true;
          const linkTarget = table.fieldLinks?.[field]?.tableId;
          return kind === "link" && Boolean(linkTarget && TBL.members && linkTarget === TBL.members);
        })
        .map(([field]) => field);
      if (personFields.length === 0) continue;
      for (const record of table.records) {
        const namesInRecord = new Set<string>();
        for (const field of personFields) {
          for (const name of splitPersonText(record.fields[field])) {
            const canonical = addCanonicalName(nameSet, name);
            if (canonical) namesInRecord.add(canonical);
          }
        }
        for (const name of namesInRecord) {
          relatedRecordCount.set(name, (relatedRecordCount.get(name) ?? 0) + 1);
        }
      }
    }
    members = [...nameSet.keys()].map((name) => {
      const profile = memberProfileByName.get(name) ?? findMemberByComparableName(name, [...memberProfileByName.values()]);
      const taskStats = statFor(name);
      const totalRelated = Math.max(taskStats.totalTasks, relatedRecordCount.get(name) ?? 0);
      return {
        id: profile?.id || `owner-${name}`,
        name,
        employeeNo: profile?.employeeNo || "",
        role: profile?.role || "成员",
        level: profile?.level || "",
        skills: profile?.skills || [],
        ...taskStats,
        totalTasks: totalRelated,
        completion: memberCompletion(name) || profile?.completion || "",
      };
    });
    // 负责人兜底：无论任务是否被换走（0 任务），负责人（表格维护人）必须固定在场
    const ownerName = OFFICE_CONFIG.ownerName;
    const ownerMember = ownerName ? findMemberByComparableName(ownerName, members) : undefined;
    if (ownerMember) {
      ownerMember.role = ownerMember.role === "成员" ? "管理员" : ownerMember.role;
    } else if (ownerName) {
      members.push({
        id: `owner-fixed-${ownerName}`,
        name: ownerName,
        employeeNo: "",
        role: "管理员",
        level: "",
        skills: [],
        ...statFor(ownerName),
        completion: memberCompletion(ownerName),
      });
    }
    const risks = riskRows.records.map(toRisk).map((risk) => ({
      ...risk,
      projectName: risk.projectId ? projectById.get(risk.projectId) : undefined,
    }));
    const milestones = milestoneRows.records.map(toMilestone).map((milestone) => ({
      ...milestone,
      projectName: milestone.projectId ? projectById.get(milestone.projectId) : undefined,
    }));

    const snapshotBase: OfficeSnapshot = {
      baseTitle: OFFICE_CONFIG.baseTitle,
      tables,
      members,
      tasks,
      projects,
      risks,
      milestones,
      syncedAt: new Date().toISOString(),
      source: "feishu",
    };
    const snapshot: OfficeSnapshot = {
      ...snapshotBase,
      analysis: buildOfficeAnalysis(snapshotBase),
    };
    rememberSnapshot(snapshot, version);
    return snapshot;
  } catch (error) {
    // 快照失败必须留痕：以前失败被吞掉，页面只显示"未授权/读失败"且无法定位是授权/限流/字段问题。
    console.error("[office-live] 快照读取失败（已降级为静态兜底）:", error instanceof Error ? (error.stack || error.message) : error);
    return {
      ...STATIC_OFFICE_SNAPSHOT,
      baseTitle: OFFICE_CONFIG.baseTitle,
      syncedAt: new Date().toISOString(),
      warning: publicFeishuError(error, "未授权或读取失败：请回到生成步骤运行 deliver.mjs 完成扫码授权（会弹出二维码），授权后刷新页面。"),
    };
  }
}

export async function fetchOfficeSnapshot(options: { force?: boolean } = {}) {
  if (!options.force && snapshotCache && Date.now() - snapshotCacheAt < SNAPSHOT_CACHE_MS) {
    return snapshotCache;
  }
  if (!options.force && snapshotInFlight) return snapshotInFlight;
  const version = snapshotVersion;
  snapshotInFlight = fetchOfficeSnapshotFresh(version).finally(() => {
    snapshotInFlight = null;
  });
  return snapshotInFlight;
}

/** 读回校验辅助：飞书写回后存在短暂最终一致延迟，带重试（最多 3 次，间隔 1.5s） */
async function readBackWithRetry(
  tableId: string,
  recordId: string,
  check: (row: Record<string, unknown> & { _recordId: string }) => boolean,
): Promise<Record<string, unknown> & { _recordId: string }> {
  let lastRow = await recordGet(tableId, recordId);
  for (let attempt = 0; attempt < 3 && !check(lastRow); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    lastRow = await recordGet(tableId, recordId);
  }
  return lastRow;
}

/**
 * 调整负责人：写回 -> read-back 校验 -> verified=true 表示已读回确认。
 */
/** 项目记录 id -> 项目名（写回文本型「项目」字段时用；按表缓存） */
let projectNameByIdCache: Map<string, string> | null = null;
async function projectNameById(): Promise<Map<string, string>> {
  if (!projectNameByIdCache) {
    const map = new Map<string, string>();
    if (TBL.projects) {
      const rows = await recordList(TBL.projects);
      for (const row of rows.records) {
        const name = one(row[FIELDS.projects.name]);
        if (name) map.set(row._recordId, name);
      }
    }
    projectNameByIdCache = map;
  }
  return projectNameByIdCache;
}

/**
 * 写回前置闸门：每次写回前实时读取分享权限。
 * 权限刚从可阅读改成可编辑时，不能继续沿用旧缓存，否则页面会误报不可写。
 */
async function assertLinkEditable(): Promise<string | null> {
  try {
    const j = await larkJson<{ data?: { permission_public?: { link_share_entity?: string } } }>(
      `drive +permission-get-setting --token ${BASE_TOKEN} --type bitable --as user --format json`,
    );
    const entity = j.data?.permission_public?.link_share_entity ?? "";
    if (entity && /editable/i.test(entity)) return null;
    return `当前表格可能是只读/可阅读权限，未开启编辑权限。请在表格右上角「分享」中，把权限改为「互联网上获得链接的人可编辑」，保存后刷新页面，即可使用写回功能。`;
  } catch {
    return null; // 读不到设置：降级由飞书服务端裁决
  }
}

/**
 * 任务表「负责人」列的真实类型——写回格式的唯一依据（绝不按"人员表是否存在"猜）：
 * link(21) 写 [recordId]；user(7) 写 [{ id }]（人员字段，id 为 open_id/用户ID）；
 * 纯文本写姓名文本。
 */
async function ownerWriteKind(): Promise<"link" | "user" | "text" | "readonly"> {
  try {
    const meta = await getTableFieldMeta(TBL.tasks);
    const name = FIELDS.tasks.owner;
    if (READONLY_TYPE_CODES.has(meta.types[name])) return "readonly";
    if (meta.links[name] || meta.types[name] === 21) return "link";
    if (meta.types[name] === 7) return "user";
    return "text";
  } catch {
    return "text";
  }
}

/**
 * 负责人写回值：按列真实类型构造。
 * link → [recordId]；user → [{ id }]（id=open_id，人员字段必须对象数组）；text → 姓名文本。
 */
function ownerWriteValue(kind: "link" | "user" | "text", ownerId: string | undefined, ownerName: string): unknown {
  if (kind === "link") {
    if (!ownerId) throw new Error(`负责人「${ownerName}」未找到可写入的关联记录 ID，无法写入关联字段。请确认该人员已出现在负责人列或关联目标表中。`);
    return [ownerId];
  }
  if (kind === "user") {
    if (!ownerId) throw new Error(`负责人「${ownerName}」未找到可写入的飞书用户身份，无法写入人员字段。请确认该人员已出现在负责人列且字段返回用户 ID。`);
    return [{ id: ownerId }];
  }
  return ownerName;
}

/**
 * 按负责人列真实类型构建姓名到写回 ID 的映射。
 * link 字段写关联记录 ID；user 字段写飞书用户 ID；text 字段不需要 ID。
 */
async function ownerIdByName(kind: "link" | "user" | "text"): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (kind === "text") return map;
  if (kind === "link" && TBL.members) {
    const rows = await recordList(TBL.members);
    for (const row of rows.records) {
      const name = one(row[FIELDS.members.name]);
      if (name) map.set(name, row._recordId);
    }
    return map;
  }
  // user 字段必须从真实负责人字段里反推用户 ID；不能拿人员档案表的记录 ID 代替。
  // 无人员表的 link 场景也从主入口负责人字段反推关联记录 ID。
  const rows = await recordList(TBL.tasks);
  for (const row of rows.records) {
    const ownerRaw = row[FIELDS.tasks.owner];
    const text = one(ownerRaw);
    const ids = linkIds(ownerRaw);
    if (ids.length) {
      const name = text || String(ids[0]);
      if (name && !map.has(name)) map.set(name, ids[0]);
    }
  }
  return map;
}

export async function reassignOfficeTask(
  taskId: string,
  ownerName: string,
  reason?: string,
): Promise<OfficeWriteOutcome> {
  const started = Date.now();
  try {
    // 写回闸门：链接必须是「可编辑」才允许写回（谁都不例外）
    const gate = await assertLinkEditable();
    if (gate) return { ok: false, verified: false, error: gate, elapsedMs: 0 };
    // 写回格式按负责人列【真实类型】判断：link→[recordId]；user→[{id}]；文本→姓名
    const ownerKind = await ownerWriteKind();
    if (ownerKind === "readonly") {
      throw new Error(`负责人列「${FIELDS.tasks.owner}」是计算列（lookup/公式/自动编号等），无法写入。请在表格中改用普通人员/文本字段。`);
    }
    const idByName = await ownerIdByName(ownerKind);
    const ownerId = idByName.get(ownerName);
    const ownerValue = ownerWriteValue(ownerKind, ownerId, ownerName);

    const fields: Record<string, unknown> = { [FIELDS.tasks.owner]: ownerValue };
    if (reason && FIELDS.tasks.remark) fields[FIELDS.tasks.remark] = reason;
    await recordUpdateRaw(BASE_TOKEN, TBL.tasks, taskId, fields);

    const readBack = await readBackWithRetry(TBL.tasks, taskId, (row) => {
      const actualOwner = linkIds(row[FIELDS.tasks.owner])[0];
      if (actualOwner) return actualOwner === ownerId;
      return one(row[FIELDS.tasks.owner]) === ownerName;
    });
    const actualOwnerId = linkIds(readBack[FIELDS.tasks.owner])[0];
    const verified = actualOwnerId ? actualOwnerId === ownerId : one(readBack[FIELDS.tasks.owner]) === ownerName;
    invalidateSnapshotCache();

    return {
      ok: true,
      verified,
      recordId: taskId,
      readBack: { ownerId: actualOwnerId || one(readBack[FIELDS.tasks.owner]) },
      elapsedMs: Date.now() - started,
    };
  } catch (error) {
    return {
      ok: false,
      verified: false,
      error: publicFeishuError(error, "负责人写回失败：请确认表格可编辑，且负责人列是可写文本、人员或关联字段。"),
      elapsedMs: Date.now() - started,
    };
  }
}

/**
 * 新增任务：按真实字段写回 -> read-back 校验新记录。
 */
export async function createOfficeTask(input: CreateOfficeTaskInput): Promise<OfficeWriteOutcome> {
  const started = Date.now();
  try {
    // 写回闸门：链接必须是「可编辑」才允许写回（谁都不例外）
    const gate = await assertLinkEditable();
    if (gate) return { ok: false, verified: false, error: gate, elapsedMs: 0 };
    // 字段真实类型 + select 选项（飞书 API 返回）：写回时按类型转换、状态默认取第一个选项
    const fieldMeta = await getTableFieldMeta(TBL.tasks).catch(() => ({
      types: {} as Record<string, number>,
      options: {} as Record<string, string[]>,
      percents: [] as string[],
      links: {} as Record<string, { tableId: string; tableName: string }>,
    }));
    const fieldTypes = fieldMeta.types;
    const fieldOptions = fieldMeta.options;
    const fieldPercents = fieldMeta.percents ?? [];
    // 写回格式按负责人列【真实类型】判断：link→[recordId]；user→[{id}]；文本→姓名
    const ownerFieldName = FIELDS.tasks.owner;
    // 只读列（lookup/formula/auto_number 等）不能写回：直接明确报错，不猜格式
    if (READONLY_TYPE_CODES.has(fieldTypes[ownerFieldName])) {
      throw new Error(`负责人列「${ownerFieldName}」是计算列（lookup/公式/自动编号等），无法写入。请在表格中改用普通人员/文本字段。`);
    }
    const ownerKind = fieldMeta.links[ownerFieldName] || fieldTypes[ownerFieldName] === 21
      ? "link"
      : fieldTypes[ownerFieldName] === 7
        ? "user"
        : "text";
    const idByName = await ownerIdByName(ownerKind);
    const ownerId = idByName.get(input.ownerName);
    const ownerValue = ownerWriteValue(ownerKind, ownerId, input.ownerName);

    const warnings: string[] = [];
    // 名称字段是关联字段（link）：把标题解析为目标表记录 ID，否则把文本写进关联字段会被飞书拒绝。
    // 未匹配到记录时不写并且提示。
    const nameFieldName = FIELDS.tasks.name;
    const nameLinkTarget = fieldMeta.links?.[nameFieldName];
    let nameLinkRecordId: string | undefined;
    if (nameLinkTarget && input.title) {
      const targetDef = OFFICE_CONFIG.tables.find((t) => t.id === nameLinkTarget.tableId);
      const targetNameField = targetDef?.fields?.name;
      if (targetNameField) {
        try {
          const rows = await recordList(nameLinkTarget.tableId);
          const hit = rows.records.find((r) => one(r[targetNameField]) === input.title);
          if (hit) nameLinkRecordId = hit._recordId;
          else warnings.push(`「${nameFieldName}」未写入：在「${nameLinkTarget.tableName || "关联表"}」中找不到名为「${input.title}」的记录。`);
        } catch {
          warnings.push(`「${nameFieldName}」未写入：读取关联表失败，无法解析名称。`);
        }
      }
    }
    const submittedFields: Record<string, unknown> = {
      ...(input.extraFields ?? {}),
      ...(input.fields ?? {}),
    };
    if (FIELDS.tasks.name && submittedFields[FIELDS.tasks.name] === undefined && input.title) {
      // 关联名称字段且未匹配到记录：不写入（已有警告）；否则写记录 ID 或原文本
      if (!nameLinkTarget || nameLinkRecordId) {
        submittedFields[FIELDS.tasks.name] = nameLinkRecordId ?? input.title;
      }
    }
    if (FIELDS.tasks.status && submittedFields[FIELDS.tasks.status] === undefined && input.status) {
      submittedFields[FIELDS.tasks.status] = input.status;
    }
    if (FIELDS.tasks.description && submittedFields[FIELDS.tasks.description] === undefined && input.description) {
      submittedFields[FIELDS.tasks.description] = input.description;
    }
    if (FIELDS.tasks.start && submittedFields[FIELDS.tasks.start] === undefined && input.startDate) {
      submittedFields[FIELDS.tasks.start] = input.startDate;
    }
    if (FIELDS.tasks.due && submittedFields[FIELDS.tasks.due] === undefined && input.dueDate) {
      submittedFields[FIELDS.tasks.due] = input.dueDate;
    }
    if (FIELDS.tasks.remark && submittedFields[FIELDS.tasks.remark] === undefined && input.remark) {
      submittedFields[FIELDS.tasks.remark] = input.remark;
    }
    if (FIELDS.tasks.project && submittedFields[FIELDS.tasks.project] === undefined && input.projectId) {
      submittedFields[FIELDS.tasks.project] = input.projectId;
    }

    const fields: Record<string, unknown> = {
      [ownerFieldName]: ownerValue,
    };
    const expectedWritten: Record<string, unknown> = {};
    for (const [fname, rawValue] of Object.entries(submittedFields)) {
      if (!fname || fname === ownerFieldName || rawValue === undefined || rawValue === null) continue;
      if (READONLY_TYPE_CODES.has(fieldTypes[fname])) {
        warnings.push(`「${fname}」未写入：该列由飞书自动生成或计算，不能手动写入。`);
        continue;
      }
      if (fieldTypes[fname] === 7) {
        warnings.push(`「${fname}」未写入：人员字段需要飞书用户身份，当前仅支持负责人列写回。`);
        continue;
      }
      let writeValue: unknown = rawValue;
      if (fieldTypes[fname] === 3) {
        const matched = matchOption(fieldOptions, fname, String(rawValue));
        if (!matched) {
          const opts = fieldOptions[fname] ?? [];
          warnings.push(`「${fname}」未写入：填写值不在该列可选范围内（可选：${opts.join(" / ") || "未读取到选项"}）。`);
          continue;
        }
        writeValue = matched;
      } else if (fieldTypes[fname] === 4 && fieldOptions[fname]?.length) {
        const values = Array.isArray(rawValue)
          ? rawValue.map(String)
          : String(rawValue).split(/[,，、;；\s]+/).filter(Boolean);
        const invalid = values.filter((value) => !matchOption(fieldOptions, fname, value));
        if (invalid.length > 0) {
          warnings.push(`「${fname}」未写入：部分填写值不在该列可选范围内（${invalid.join(" / ")}）。`);
          continue;
        }
        writeValue = values.map((value) => matchOption(fieldOptions, fname, value)).filter(Boolean);
      }
      const coerced = coerceFieldValue(fname, writeValue, fieldTypes, fieldPercents);
      if (!isEmptyWriteValue(coerced)) {
        fields[fname] = coerced;
        expectedWritten[fname] = coerced;
      }
    }

    const recordId = await recordCreateRaw(BASE_TOKEN, TBL.tasks, fields);
    if (!recordId) throw new Error("飞书已创建记录但未返回 record_id，请刷新确认。");

    // 新增记录后字段可能需要短暂同步，读回校验带重试。校验每个已提交且可写的字段，避免部分字段漏写仍误判成功。
    const readBack = await readBackWithRetry(TBL.tasks, recordId, (row) => {
      const ownerOk = ownerKind === "text"
        ? one(row[ownerFieldName]) === input.ownerName
        : linkIds(row[ownerFieldName])[0] === ownerId;
      if (!ownerOk) return false;
      return Object.entries(expectedWritten).every(([fname, expected]) =>
        writtenFieldMatches(fname, expected, row[fname], fieldTypes),
      );
    });
    const actualTitle = one(readBack[FIELDS.tasks.name]);
    const actualOwnerId = linkIds(readBack[ownerFieldName])[0];
    const failedFields = Object.entries(expectedWritten)
      .filter(([fname, expected]) => !writtenFieldMatches(fname, expected, readBack[fname], fieldTypes))
      .map(([fname]) => fname);
    const verified =
      (ownerKind === "text"
        ? one(readBack[ownerFieldName]) === input.ownerName
        : actualOwnerId === ownerId) &&
      failedFields.length === 0;
    invalidateSnapshotCache();

    return {
      ok: true,
      verified,
      recordId,
      readBack: { title: actualTitle, ownerId: actualOwnerId, failedFields },
      elapsedMs: Date.now() - started,
      warnings,
    };
  } catch (error) {
    return {
      ok: false,
      verified: false,
      error: publicFeishuError(error, "新增任务写回失败：请确认表格可编辑，且必填字段是可写字段。"),
      elapsedMs: Date.now() - started,
    };
  }
}
