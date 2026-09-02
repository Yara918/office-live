/**
 * analysis.ts —— 全字段数据分析（纯真实数据，零预设词）。
 *
 * 原则：表里有就展示，没有就不写。不判断"哪个字段是状态/完成度/截止"，
 * 不预设任何业务词——每个字段按真实值展示分布/汇总，并做字段间交叉组合。
 * "已签约未回款"这类分析点 = 签约状态 × 收款进度的交叉结果，由数据自己涌现。
 */

/** 单字段分布：选项列的值计数 / 数字列的汇总 / 文本列的样本 */
export type FieldAnalysis = {
  field: string;
  /** 飞书原始类型 */
  type: string;
  /** 值分布（前 20 个值及其计数） */
  distribution: { value: string; count: number }[];
  /** 数字字段汇总（若有） */
  number?: { min: number; max: number; avg: number; sum: number };
  /** 日期字段范围（若有） */
  date?: { min: string; max: string };
  /** 空值率 0~1 */
  nullRate: number;
  /** 非空记录数 */
  nonNull: number;
};

/** 两张表的字段交叉：维度字段值 × 度量字段值（或分布字段值） */
export type CrossAnalysis = {
  /** 维度字段（分组依据） */
  dimField: string;
  /** 度量字段（被聚合的） */
  metricField: string;
  /** 交叉结果：维度值 → 度量汇总 */
  rows: {
    dimValue: string;
    count: number;
    /** 度量是数字时的均值/和（若有） */
    avg?: number;
    sum?: number;
    /** 度量是选项时的值分布 */
    distribution?: { value: string; count: number }[];
  }[];
};

/** 值归一化：提取可读文本（user/link 取 name，数组连接，数字原样） */
export function normValue(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) {
    if (v.length === 0) return "";
    return v
      .map((x) => (x && typeof x === "object" ? String(x.name ?? x.text ?? x.id ?? "") : String(x)))
      .filter(Boolean)
      .join("、");
  }
  if (typeof v === "object") return String((v as { name?: unknown; text?: unknown; id?: unknown }).name ?? (v as { text?: unknown }).text ?? (v as { id?: unknown }).id ?? "");
  return String(v);
}

// ── 画像语义推断（feishu-office 依赖）：类型+值分布 → 字段语义 ──

export type FieldProfile = {
  field: string;
  type: string;
  nullRate: number;
  nonNull: number;
  distinctCount: number;
  topValues: { value: string; count: number }[];
  number?: { min: number; max: number; avg: number };
  date?: { min: string; max: string };
};

export type TableProfile = {
  tableId: string;
  tableName: string;
  recordCount: number;
  hasMore: boolean;
  fields: FieldProfile[];
};

export type FieldSemantic =
  | "person"
  | "status"
  | "category"
  | "percent"
  | "measure"
  | "datetime"
  | "link"
  | "id"
  | "text"
  | "readonly"
  | "meta";

export type SemanticField = {
  field: string;
  type: string;
  semantic: FieldSemantic;
  reason: string;
};

const READONLY_TYPES = new Set([
  "formula",
  "lookup",
  "rollup",
  "auto_number",
  "created_by",
  "modified_by",
  "created_time",
  "modified_time",
  "button",
  "group",
]);
const META_DATE_TYPES = new Set(["created_at", "updated_at"]);

export function inferFieldSemantic(profile: FieldProfile): SemanticField {
  const { type, distinctCount, topValues, number } = profile;
  if (READONLY_TYPES.has(type)) {
    if (type === "auto_number") return { field: profile.field, type, semantic: "id", reason: `auto_number 自动编号` };
    return { field: profile.field, type, semantic: "readonly", reason: `${type} 只读计算列` };
  }
  if (type === "user") return { field: profile.field, type, semantic: "person", reason: `user 人员列` };
  if (META_DATE_TYPES.has(type)) return { field: profile.field, type, semantic: "meta", reason: `${type} 系统时间` };
  if (type === "datetime") return { field: profile.field, type, semantic: "datetime", reason: `日期列` };
  if (type === "link") return { field: profile.field, type, semantic: "link", reason: `关联列` };
  if (type === "select") {
    if (distinctCount >= 2 && distinctCount <= 12) return { field: profile.field, type, semantic: "status", reason: `选项列去重=${distinctCount}` };
    return { field: profile.field, type, semantic: "category", reason: `选项列去重=${distinctCount}` };
  }
  if (type === "number") {
    if (number) {
      if (number.min >= 0 && number.max <= 1) return { field: profile.field, type, semantic: "percent", reason: `数字 0~1` };
      return { field: profile.field, type, semantic: "measure", reason: `数字度量` };
    }
  }
  if (type === "text") {
    if (distinctCount >= profile.nonNull * 0.8) return { field: profile.field, type, semantic: "text", reason: `文本明细` };
    return { field: profile.field, type, semantic: "category", reason: `文本重复` };
  }
  return { field: profile.field, type, semantic: "text", reason: `默认文本` };
}

export function inferTableSemantics(profile: TableProfile): SemanticField[] {
  return profile.fields.map(inferFieldSemantic);
}

export function keySemantics(fields: SemanticField[]) {
  return {
    persons: fields.filter((f) => f.semantic === "person"),
    statuses: fields.filter((f) => f.semantic === "status"),
    percents: fields.filter((f) => f.semantic === "percent"),
    dates: fields.filter((f) => f.semantic === "datetime"),
    readonly: fields.filter((f) => f.semantic === "readonly"),
  };
}

/** 单字段分析（纯数据，不判断语义） */
export function analyzeField(field: string, values: unknown[]): FieldAnalysis {
  const nonNullVals = values.filter((v) => normValue(v) !== "");
  const nullRate = values.length > 0 ? (values.length - nonNullVals.length) / values.length : 0;
  const dist = new Map<string, number>();
  for (const v of nonNullVals) {
    const k = normValue(v);
    dist.set(k, (dist.get(k) || 0) + 1);
  }
  const distribution = [...dist.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([value, count]) => ({ value, count }));

  const analysis: FieldAnalysis = { field, type: "", distribution, nullRate, nonNull: nonNullVals.length };

  // 数字：如果值几乎都是数字 → 汇总
  const numeric: number[] = nonNullVals
    .map((v) => Number(normValue(v)))
    .filter((n): n is number => Number.isFinite(n));
  if (numeric.length > 0 && numeric.length / Math.max(nonNullVals.length, 1) > 0.8) {
    analysis.number = {
      min: Math.min(...numeric),
      max: Math.max(...numeric),
      avg: Number((numeric.reduce((a, b) => a + b, 0) / numeric.length).toFixed(2)),
      sum: numeric.reduce((a, b) => a + b, 0),
    };
  }
  // 日期：值形如日期 → 范围
  const dateStrs = nonNullVals.map((v) => (String(normValue(v)).match(/^\d{4}-\d{2}-\d{2}/) || [""])[0]).filter(Boolean);
  if (dateStrs.length > 0) {
    const sorted = [...dateStrs].sort();
    analysis.date = { min: sorted[0], max: sorted[sorted.length - 1] };
  }
  return analysis;
}

/**
 * 交叉分析：维度字段 × 度量字段。
 * - 度量是数字 → 每个维度值的均值/和
 * - 度量是选项/文本 → 每个维度值的值分布
 * 零预设词：不判断哪个是"状态"，所有组合如实呈现。
 */
export function crossAnalyze(
  rows: Record<string, unknown>[],
  dimField: string,
  metricField: string,
): CrossAnalysis {
  const groups = new Map<string, { count: number; nums: number[]; dist: Map<string, number> }>();
  for (const row of rows) {
    const dv = normValue(row[dimField]) || "(空)";
    const g = groups.get(dv) ?? { count: 0, nums: [], dist: new Map<string, number>() };
    g.count += 1;
    const mv = normValue(row[metricField]);
    if (mv) g.dist.set(mv, (g.dist.get(mv) || 0) + 1);
    const n = Number(mv);
    if (Number.isFinite(n)) g.nums.push(n);
    groups.set(dv, g);
  }

  const out = [...groups.entries()].map(([dimValue, g]) => {
    const row: CrossAnalysis["rows"][number] = { dimValue, count: g.count };
    if (g.nums.length > 0) {
      row.avg = Number((g.nums.reduce((a, b) => a + b, 0) / g.nums.length).toFixed(2));
      row.sum = g.nums.reduce((a, b) => a + b, 0);
    }
    if (g.dist.size > 0) {
      row.distribution = [...g.dist.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
    }
    return row;
  });

  return { dimField, metricField, rows: out };
}

/**
 * 全表分析：每个字段的分布 + 自动交叉（维度=短分类字段，度量=数字字段）。
 * 维度字段 = 值重复出现的短分类字段（选项/短文本），度量字段 = 数字字段。
 * 返回所有维度×度量的组合，供页面展示——"已签约未回款"就是 签订状态×收款进度 的交叉行。
 */
export function analyzeTable(records: Record<string, unknown>[]) {
  if (records.length === 0) return { fields: [], crosses: [] };

  const allFields = Object.keys(records[0]);
  const fieldAnalyses: FieldAnalysis[] = [];
  const dimFields: string[] = []; // 短分类字段（可作维度）
  const metricFields: string[] = []; // 数字字段（可作度量）

  for (const f of allFields) {
    const values = records.map((r) => r[f]);
    const a = analyzeField(f, values);
    fieldAnalyses.push(a);
    // 维度：分布去重 2~30 且非数字 → 可作维度
    if (a.distribution.length >= 2 && a.distribution.length <= 30 && !a.number && !a.date) {
      dimFields.push(f);
    }
    // 度量：数字字段
    if (a.number) metricFields.push(f);
  }

  // 交叉：每个维度 × 每个度量
  const crosses: CrossAnalysis[] = [];
  for (const dim of dimFields.slice(0, 5)) {
    for (const metric of metricFields.slice(0, 3)) {
      crosses.push(crossAnalyze(records, dim, metric));
    }
  }

  return { fields: fieldAnalyses, crosses, dimFields, metricFields };
}
