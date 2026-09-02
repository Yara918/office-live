import { OFFICE_CONFIG, fieldsOf, tableTitle } from "./office-config";
import {
  fieldValueText,
  personComparableName,
  type OfficeAnalysis,
  type OfficeAnalysisInsight,
  type OfficeFieldKind,
  type OfficeFieldSummary,
  type OfficePersonJourney,
  type OfficeProgressSummary,
  type OfficeSnapshot,
  type OfficeSubjectMap,
  type OfficeTable,
  type OfficeTableProfile,
} from "./office-data";

const READONLY_TYPES = new Set<number>([90]);

function parseNumber(value: unknown): number | null {
  const raw = fieldValueText(value).replace(/,/g, "").replace("%", "").trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function topValues(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([value, count]) => ({ value, count }));
}

function summarizeField(table: OfficeTable, field: string): OfficeFieldSummary {
  const values = table.records.map((record) => fieldValueText(record.fields[field]).trim());
  const filled = values.filter(Boolean);
  const nums = table.records
    .map((record) => parseNumber(record.fields[field]))
    .filter((n): n is number => n != null);
  const summary: OfficeFieldSummary = {
    table: table.title,
    field,
    kind: table.fieldKinds[field] ?? "other",
    type: table.fieldTypes[field],
    nonEmpty: filled.length,
    empty: values.length - filled.length,
    examples: [...new Set(filled)].slice(0, 5),
    topValues: topValues(filled),
  };
  if (
    nums.length > 0 &&
    nums.length / Math.max(filled.length, 1) >= 0.8 &&
    !isIdentifierLikeField(field) &&
    !isTimeLikeField(field)
  ) {
    const sum = nums.reduce((acc, n) => acc + n, 0);
    summary.number = {
      sum,
      min: Math.min(...nums),
      max: Math.max(...nums),
      avg: Number((sum / nums.length).toFixed(2)),
    };
  }
  return summary;
}

function allFields(table: OfficeTable): string[] {
  const names = new Set<string>(Object.keys(table.fieldKinds));
  for (const record of table.records) {
    for (const name of Object.keys(record.fields)) names.add(name);
  }
  return [...names].filter(Boolean);
}

function looksLikeId(values: string[]) {
  if (values.length === 0) return false;
  const hits = values.filter((value) => /^[A-Z]{1,8}[-_]?\d{3,}|^\d{4,}$/.test(value.trim()));
  return hits.length / values.length >= 0.7;
}

function isTimeLikeField(field: string) {
  return /日期|时间|期限|有效期|到期|过期|截止|签约|生效|跟进|沟通|回访|拜访|预约|续约|剩余.*天|天数|timestamp|date|time|deadline|expire|due|signed|effective|follow|contact|visit|renew/i.test(field);
}

function parseDateText(value: unknown): string {
  const raw = fieldValueText(value).trim();
  if (!raw) return "";
  const match = raw.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (match) {
    const [, y, m, d] = match;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return "";
}

function isDateLikeField(table: OfficeTable, field: string) {
  if (table.fieldKinds[field] === "date" || isTimeLikeField(field)) return true;
  const values = table.records.map((record) => parseDateText(record.fields[field])).filter(Boolean);
  return values.length > 0 && values.length / Math.max(table.records.length, 1) >= 0.6;
}

function statusNameScore(field: string) {
  if (/状态|阶段|进度|结果|是否|status|stage|phase|state|result/i.test(field)) return 100;
  if (/优先级|等级|类型|分类|方式|渠道|来源|priority|type|category|method|channel|source/i.test(field)) return 30;
  return 0;
}

function isStatusLikeField(table: OfficeTable, field: string) {
  if (table.fieldKinds[field] === "status") return true;
  if (isIdentifierLikeField(field) || isContactLikeField(field) || isNarrativeField(field) || isTimeLikeField(field)) return false;
  const score = statusNameScore(field);
  if (score < 100) return false;
  const values = table.records.map((record) => fieldValueText(record.fields[field]).trim()).filter(Boolean);
  if (values.length === 0) return false;
  const distinct = new Set(values);
  if (distinct.size < 1 || distinct.size > Math.max(15, Math.ceil(table.records.length * 0.7))) return false;
  const shortEnough = values.filter((value) => value.length <= 24 && !/^(rec[a-zA-Z0-9]{8,}|\d{4,})$/.test(value)).length;
  return shortEnough / values.length >= 0.8;
}

function isIdentifierLikeField(field: string) {
  return /编号|编码|序号|单号|工号|手机号|手机|电话|座机|联系方式|邮箱|邮件|邮编|身份证|证件|id|code|no\.?|number|phone|mobile|tel|email|mail|zip|postal/i.test(field);
}

function isContactLikeField(field: string) {
  return /联系人|联络人|客户联系人|姓名|负责人|成员|人员|员工|用户|客户经理|销售|owner|assignee|member|person|user|contact/i.test(field);
}

function isNarrativeField(field: string) {
  return /备注|说明|描述|详情|内容|评论|补充|原因|note|remark|desc|description|comment|memo/i.test(field);
}

function pickValueField(fields: string[]) {
  return (
    fields.find((field) => /未收|欠|应收|余额|待收|差额/i.test(field)) ??
    fields.find((field) => /金额|收入|成本|预算|费用|款|合计|小计|amount|revenue|cost|budget|fee|price/i.test(field)) ??
    fields.find((field) => /数量|总数|件数|人数|次数|count|qty|quantity/i.test(field)) ??
    fields[0]
  );
}

function isMeasureField(table: OfficeTable, field: string) {
  if (table.fieldKinds[field] !== "number" && !summarizeField(table, field).number) return false;
  if (isIdentifierLikeField(field) || isTimeLikeField(field)) return false;
  if (isRatioField(table, field)) return false;
  return true;
}

function actionDateScore(field: string) {
  if (/下次|跟进|沟通|回访|拜访|预约|提醒|续约|到期|过期|截止|deadline|expire|due|follow|contact|visit|renew/i.test(field)) return 100;
  if (/签约|生效|开始|完成|交付|上线|signed|effective|start|finish|complete|launch/i.test(field)) return 60;
  if (/创建|更新|建档|录入|modified|created|updated/i.test(field)) return 10;
  return 40;
}

function shouldAssessDateUrgency(table: OfficeTable, field: string) {
  const text = `${table.title} ${field}`.toLowerCase();
  const isLifecycleFact =
    /入职|离职|出生|生日|年龄|成立|开户|注册|创建|更新|建档|录入|登记|签约|签署|生效|开始|实际|完成于|已完成|交付于|已交付|上线|归档|关闭|结案|created|updated|modified|registered|signed|effective|start|started|actual|finished|completed|closed|archived|birth|hire|joined|onboard|leave|resign/i.test(text);
  const isHardDeadline =
    /下次|待跟进|需跟进|跟进提醒|沟通提醒|回访提醒|拜访提醒|预约|提醒|催办|期限|截止|截至|到期|过期|逾期|超期|续约|复查|复检|年检|复审|deadline|expire|expiry|due|overdue|follow[-_ ]?up|remind|renewal|review/i.test(text);
  const isCommittedPlan =
    /计划完成|预计完成|承诺完成|计划交付|预计交付|承诺交付|交付期|交期|应回款|待回款|计划回款|预计回款|应收款|待收款|应付款|待付款|planned completion|expected completion|planned delivery|expected delivery|payment due/i.test(text);

  if (isHardDeadline) return true;
  if (isLifecycleFact) return false;
  return isCommittedPlan;
}

function isRatioField(table: OfficeTable, field: string) {
  const summary = summarizeField(table, field);
  if (!summary.number) return false;
  if (table.fieldPercents?.includes(field)) return true;
  if (/进度|完成率|完成度|比例|占比|率|percent|rate|progress/i.test(field)) return true;
  const values = table.records.map((record) => parseNumber(record.fields[field])).filter((n): n is number => n != null);
  return values.length > 0 && values.every((n) => n >= 0 && n <= 1);
}

function splitPeople(value: unknown) {
  return fieldValueText(value)
    .split(/[、,，;；]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function pickBusinessSubjects(table: OfficeTable, workItem?: string, people: string[] = []) {
  const blocked = new Set([workItem, ...people].filter(Boolean));
  return allFields(table).map((field) => {
    if (blocked.has(field)) return false;
    const kind = table.fieldKinds[field];
    const type = table.fieldTypes[field];
    const summary = summarizeField(table, field);
    const values = table.records.map((r) => fieldValueText(r.fields[field]).trim()).filter(Boolean);
    const distinct = new Set(values);
    if (summary.number || looksLikeId(values)) return false;
    if (isIdentifierLikeField(field) || isContactLikeField(field) || isNarrativeField(field)) return false;
    if (kind === "status" || kind === "group" || kind === "date" || isTimeLikeField(field)) return false;
    if (READONLY_TYPES.has(type) && kind !== "link") {
      if (distinct.size < 2 || distinct.size > Math.max(30, table.records.length)) return false;
      if (values.length > 0 && distinct.size / values.length > 0.7) return false;
      return { field, score: 80 + Math.min(distinct.size, 20) };
    }
    if (kind === "link") return { field, score: 90 + Math.min(distinct.size, 20) };
    if (kind === "text") {
      if (values.length === 0 || distinct.size > Math.max(30, table.records.length)) return false;
      if (distinct.size / values.length > 0.7) return false;
      return { field, score: 60 + Math.min(distinct.size, 20) };
    }
    return false;
  })
    .filter((item): item is { field: string; score: number } => Boolean(item))
    .sort((a, b) => b.score - a.score)
    .map((item) => item.field);
}

function buildTableProfiles(snapshot: OfficeSnapshot): OfficeTableProfile[] {
  const taskFields = fieldsOf("tasks");
  return snapshot.tables.map((table) => {
    const fields = allFields(table);
    const nameFields = fields.filter((field) => table.fieldKinds[field] === "name" || field === taskFields.name);
    const personFields = fields.filter((field) => table.fieldKinds[field] === "person" || field === taskFields.owner);
    const statusFields = fields
      .filter((field) => isStatusLikeField(table, field))
      .sort((a, b) => statusNameScore(b) - statusNameScore(a));
    const timeFields = fields
      .filter((field) => isDateLikeField(table, field))
      .sort((a, b) => actionDateScore(b) - actionDateScore(a));
    const valueFields = fields.filter((field) => isMeasureField(table, field));
    const ratioFields = fields.filter((field) => isRatioField(table, field));
    const relationFields = fields.filter((field) => table.fieldKinds[field] === "link" || table.fieldTypes[field] === 21);
    const readonlyFields = fields.filter((field) => READONLY_TYPES.has(table.fieldTypes[field]));
    return {
      table: table.title,
      tableId: table.id,
      recordCount: table.records.length,
      fieldCount: fields.length,
      nameFields,
      personFields,
      statusFields,
      timeFields,
      valueFields,
      ratioFields,
      relationFields,
      readonlyFields,
      writableFields: fields.filter((field) => !readonlyFields.includes(field)),
    };
  });
}

function buildSubjectMap(snapshot: OfficeSnapshot): OfficeSubjectMap {
  const taskFields = fieldsOf("tasks");
  const mainTableName = tableTitle("tasks", snapshot.tables.find((t) => t.role === "tasks")?.title ?? "主入口表");
  const mainTable = snapshot.tables.find((t) => t.role === "tasks") ?? snapshot.tables[0];
  if (!mainTable) {
    return {
      mainTable: mainTableName,
      people: [],
      businessSubjects: [],
      valueFields: [],
      statusFields: [],
      timeFields: [],
      relationFields: [],
      readonlyFields: [],
    };
  }

  const fields = allFields(mainTable);
  const people = [...new Set([taskFields.owner, ...fields.filter((f) => mainTable.fieldKinds[f] === "person")].filter(Boolean))];
  const workItem = taskFields.name && fields.includes(taskFields.name) ? taskFields.name : undefined;
  return {
    mainTable: mainTable.title,
    workItem,
    people,
    businessSubjects: pickBusinessSubjects(mainTable, workItem, people).slice(0, 6),
    valueFields: fields.filter((f) => isMeasureField(mainTable, f)).slice(0, 8),
    statusFields: fields
      .filter((f) => isStatusLikeField(mainTable, f))
      .sort((a, b) => statusNameScore(b) - statusNameScore(a))
      .slice(0, 8),
    timeFields: fields
      .filter((f) => isDateLikeField(mainTable, f))
      .sort((a, b) => actionDateScore(b) - actionDateScore(a))
      .slice(0, 8),
    relationFields: fields.filter((f) => mainTable.fieldKinds[f] === "link" || mainTable.fieldTypes[f] === 21).slice(0, 8),
    readonlyFields: fields.filter((f) => READONLY_TYPES.has(mainTable.fieldTypes[f])),
  };
}

function groupRows(table: OfficeTable, dimField: string, metricField?: string, options?: { splitDim?: boolean }) {
  const groups = new Map<string, { count: number; sum: number }>();
  for (const record of table.records) {
    const rawKey = fieldValueText(record.fields[dimField]).trim();
    const keys = options?.splitDim
      ? rawKey.split(/[、,，;；]/).map((part) => part.trim()).filter(Boolean)
      : [rawKey].filter(Boolean);
    const metric = metricField ? parseNumber(record.fields[metricField]) ?? 0 : 0;
    for (const key of keys.length > 0 ? keys : ["(空)"]) {
      const current = groups.get(key) ?? { count: 0, sum: 0 };
      current.count += 1;
      if (metricField) current.sum += metric;
      groups.set(key, current);
    }
  }
  return [...groups.entries()]
    .map(([name, value]) => ({ name, ...value }))
    .sort((a, b) => (metricField ? b.sum - a.sum : b.count - a.count));
}

function formatGroupedRows(
  rows: { name: string; count: number; sum: number }[],
  valueField?: string,
  limit = rows.length,
) {
  const visible = rows.slice(0, limit);
  return visible
    .map((row) => `${row.name} ${valueField ? row.sum.toLocaleString() : `${row.count}条`}`)
    .join("；");
}

function formatPersonRows(rows: { name: string; count: number; sum: number }[], valueField?: string) {
  return formatGroupedRows(rows, valueField, rows.length);
}

function formatPercent(value: number) {
  return `${Math.round(Math.max(0, Math.min(100, value)))}%`;
}

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildDateInsight(table: OfficeTable, dateField: string): OfficeAnalysisInsight | undefined {
  const dates = table.records
    .map((record) => parseDateText(record.fields[dateField]))
    .filter(Boolean)
    .sort();
  if (dates.length === 0) return undefined;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayKey = localDateKey(today);
  const next7 = new Date(today);
  next7.setDate(today.getDate() + 7);
  const next7Key = localDateKey(next7);
  const assessUrgency = shouldAssessDateUrgency(table, dateField);
  const overdue = assessUrgency ? dates.filter((date) => date < todayKey).length : 0;
  const dueToday = assessUrgency ? dates.filter((date) => date === todayKey).length : 0;
  const soon = assessUrgency ? dates.filter((date) => date > todayKey && date <= next7Key).length : 0;
  const range = `${dates[0]} 至 ${dates[dates.length - 1]}`;
  const parts = [];
  if (overdue > 0) parts.push(`已过期 ${overdue}`);
  if (dueToday > 0) parts.push(`今日 ${dueToday}`);
  if (soon > 0) parts.push(`7天内 ${soon}`);
  const summary = assessUrgency && parts.length > 0 ? `${parts.join("；")}；范围 ${range}` : `范围 ${range}`;
  return {
    id: `date-${table.id}-${dateField}`,
    title: `${table.title}：${dateField}`,
    summary,
    severity: assessUrgency && (overdue > 0 || dueToday > 0 || soon > 0) ? "attention" : "info",
    sources: [{ table: table.title, field: dateField, role: "time" }],
  };
}

function normalizedRatio(value: unknown): number | null {
  const n = parseNumber(value);
  if (n == null) return null;
  if (n >= 0 && n <= 1) return n * 100;
  if (n >= 0 && n <= 100) return n;
  return null;
}

function buildInsights(snapshot: OfficeSnapshot, subjectMap: OfficeSubjectMap, profiles: OfficeTableProfile[]): OfficeAnalysisInsight[] {
  const insights: OfficeAnalysisInsight[] = [];

  for (const profile of profiles) {
    const table = snapshot.tables.find((item) => item.id === profile.tableId);
    if (!table) continue;

    const dateField = profile.timeFields[0];
    if (dateField) {
      const insight = buildDateInsight(table, dateField);
      if (insight) insights.push(insight);
    }

    const statusField = profile.statusFields[0];
    if (statusField) {
      const rows = groupRows(table, statusField);
      if (rows.length > 0) {
        insights.push({
          id: `status-${table.id}-${statusField}`,
          title: `${table.title}：${statusField}`,
          summary: formatGroupedRows(rows),
          severity: "info",
          sources: [{ table: table.title, field: statusField, role: "status" }],
        });
      }
    }

    const valueField = pickValueField(profile.valueFields);
    if (valueField) {
      const fieldSummary = summarizeField(table, valueField);
      if (fieldSummary.number) {
        insights.push({
          id: `value-${table.id}-${valueField}`,
          title: `${table.title}：${valueField}`,
          summary: `合计 ${fieldSummary.number.sum.toLocaleString()}，平均 ${fieldSummary.number.avg.toLocaleString()}。`,
          severity: "info",
          sources: [{ table: table.title, field: valueField, role: "value" }],
        });
      }
    }
  }

  const tableWithPeople = profiles.find((profile) => profile.personFields.length > 0);
  if (tableWithPeople) {
    const table = snapshot.tables.find((item) => item.id === tableWithPeople.tableId);
    const personField = tableWithPeople.personFields[0];
    const valueField =
      pickValueField(tableWithPeople.valueFields);
    if (table && personField) {
      const rows = groupRows(table, personField, valueField, { splitDim: true });
      if (rows.length > 0) {
        insights.push({
          id: `person-${table.id}-${personField}-${valueField ?? "count"}`,
          title: valueField ? `${table.title}：按${personField}看${valueField}` : `${table.title}：按${personField}看记录`,
          summary: formatPersonRows(rows, valueField),
          severity: "attention",
          sources: [
            { table: table.title, field: personField, role: "person" },
            ...(valueField ? [{ table: table.title, field: valueField, role: "value" }] : []),
          ],
        });
      }
    }
  }

  const main = snapshot.tables.find((t) => t.title === subjectMap.mainTable) ?? snapshot.tables[0];
  if (!main) return insights;
  const moneyLike =
    pickValueField(subjectMap.valueFields);
  const personField = subjectMap.people[0];
  const businessField = subjectMap.businessSubjects.find((f) => f !== personField);
  const statusField = subjectMap.statusFields[0];

  if (moneyLike) {
    const fieldSummary = summarizeField(main, moneyLike);
    if (fieldSummary.number) {
      insights.push({
        id: "main-value-total",
        title: `${main.title}：${moneyLike}`,
        summary: `合计 ${fieldSummary.number.sum.toLocaleString()}，平均 ${fieldSummary.number.avg.toLocaleString()}。`,
        severity: "info",
        sources: [{ table: main.title, field: moneyLike, role: "value" }],
      });
    }
  }

  if (personField && moneyLike) {
    const rows = groupRows(main, personField, moneyLike, { splitDim: true });
    if (rows.length > 0) {
      insights.push({
        id: "person-value-rank",
        title: `${main.title}：按${personField}看${moneyLike}`,
        summary: formatPersonRows(rows, moneyLike),
        severity: "attention",
        sources: [
          { table: main.title, field: personField, role: "person" },
          { table: main.title, field: moneyLike, role: "value" },
        ],
      });
    }
  }

  if (businessField && moneyLike) {
    const rows = groupRows(main, businessField, moneyLike);
    if (rows.length > 0) {
      insights.push({
        id: "subject-value-rank",
        title: `${main.title}：按${businessField}看${moneyLike}`,
        summary: formatGroupedRows(rows, moneyLike),
        severity: "attention",
        sources: [
          { table: main.title, field: businessField, role: "businessSubject" },
          { table: main.title, field: moneyLike, role: "value" },
        ],
      });
    }
  }

  if (statusField) {
    const rows = groupRows(main, statusField);
    insights.push({
      id: "status-distribution",
      title: `${main.title}：${statusField}`,
      summary: formatGroupedRows(rows),
      severity: "info",
      sources: [{ table: main.title, field: statusField, role: "status" }],
    });
  }

  const seen = new Set<string>();
  return insights.filter((insight) => {
    const key = `${insight.title}\n${insight.summary}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function progressFromRatioRows(
  table: OfficeTable,
  rows: { record: OfficeTable["records"][number]; profile: OfficeTableProfile }[],
  ratioField: string,
): OfficeProgressSummary | undefined {
  // 完成度/进度/完成率等现成比例字段：直接取表格原值做平均汇总，不自动引入金额/数量/预算等字段做加权。
  // 计算规则（全量客户通用，任何表都适用）：
  //   ① 表里有现成的「进度/完成率/完成度」等比例字段 → 必须取表格原值平均汇总；
  //   ② 表格没有现成比例字段、需要自行计算时 → 只能用与进度真正关联的字段计算
  //      （如「已完成/已结束记录数 ÷ 总记录数」这类语义直接相关的口径）；
  //   ③ 金额/数量/预算等字段与完成度无因果关联，不能作为权重，否则算出的数值不可信；
  //   ④ 算不出语义合理的数值时，保留原字段/原值展示，不编造结论。
  const values: number[] = [];
  for (const item of rows) {
    const ratio = normalizedRatio(item.record.fields[ratioField]);
    if (ratio == null) continue;
    values.push(ratio);
  }
  if (values.length === 0) return undefined;
  const value = values.reduce((sum, n) => sum + n, 0) / values.length;
  return {
    label: ratioField,
    value,
    text: formatPercent(value),
    method: `${ratioField} 平均`,
    sources: [{ table: table.title, field: ratioField, role: "ratio" }],
  };
}

function progressFromStatusRows(
  table: OfficeTable,
  rows: { record: OfficeTable["records"][number]; profile: OfficeTableProfile }[],
  statusField: string,
): OfficeProgressSummary | undefined {
  const doneWords = /完成|完结|结束|已签|已收|已处理|已关闭|成交|通过|done|closed|complete/i;
  const values = rows.map((item) => fieldValueText(item.record.fields[statusField]).trim()).filter(Boolean);
  if (values.length === 0) return undefined;
  const done = values.filter((value) => doneWords.test(value)).length;
  if (done === 0) return undefined;
  const value = (done / values.length) * 100;
  return {
    label: statusField,
    value,
    text: formatPercent(value),
    method: `按 ${statusField} 中的终态值占比计算`,
    sources: [{ table: table.title, field: statusField, role: "status" }],
  };
}

function buildPersonJourneys(snapshot: OfficeSnapshot, profiles: OfficeTableProfile[]): OfficePersonJourney[] {
  return snapshot.members.map((member) => {
    const rows: { table: OfficeTable; profile: OfficeTableProfile; record: OfficeTable["records"][number] }[] = [];
    for (const table of snapshot.tables) {
      const profile = profiles.find((item) => item.tableId === table.id);
      if (!profile || profile.personFields.length === 0) continue;
      for (const record of table.records) {
        const target = personComparableName(member.name);
        const hit = profile.personFields.some((field) =>
          splitPeople(record.fields[field]).some((name) => {
            const clean = name.trim();
            return clean === member.name || (target !== "" && personComparableName(clean) === target);
          }),
        );
        if (hit) rows.push({ table, profile, record });
      }
    }

    const byTable = new Map<string, number>();
    for (const row of rows) byTable.set(row.table.title, (byTable.get(row.table.title) ?? 0) + 1);

    let progress: OfficeProgressSummary | undefined;
    const ratioCandidate = rows.find((row) => row.profile.ratioFields.length > 0);
    if (ratioCandidate) {
      const field = ratioCandidate.profile.ratioFields[0];
      const sameTableRows = rows.filter((row) => row.table.id === ratioCandidate.table.id);
      progress = progressFromRatioRows(ratioCandidate.table, sameTableRows, field);
    }
    if (!progress) {
      const statusCandidate = rows.find((row) => row.profile.statusFields.length > 0);
      if (statusCandidate) {
        const field = statusCandidate.profile.statusFields[0];
        const sameTableRows = rows.filter((row) => row.table.id === statusCandidate.table.id);
        progress = progressFromStatusRows(statusCandidate.table, sameTableRows, field);
      }
    }

    const highlights: string[] = [];
    if (rows.length > 0) highlights.push(`关联记录 ${rows.length} 条`);
    const valueCandidate = rows.find((row) => row.profile.valueFields.length > 0);
    if (valueCandidate) {
      const field =
        pickValueField(valueCandidate.profile.valueFields);
      const total = rows
        .filter((row) => row.table.id === valueCandidate.table.id)
        .reduce((sum, row) => sum + (parseNumber(row.record.fields[field]) ?? 0), 0);
      if (total !== 0) highlights.push(`${field} ${total.toLocaleString()}`);
    }
    const statusCandidate = rows.find((row) => row.profile.statusFields.length > 0);
    if (statusCandidate) {
      const field = statusCandidate.profile.statusFields[0];
      const counts = groupRows(
        {
          ...statusCandidate.table,
          records: rows.filter((row) => row.table.id === statusCandidate.table.id).map((row) => row.record),
        },
        field,
      ).slice(0, 3);
      if (counts.length > 0) highlights.push(counts.map((row) => `${row.name} ${row.count}`).join("；"));
    }

    return {
      name: member.name,
      recordCount: rows.length,
      tableCount: byTable.size,
      tables: [...byTable.entries()].map(([table, count]) => ({ table, count })),
      progress,
      highlights: highlights.slice(0, 3),
    };
  });
}

export function buildOfficeAnalysis(snapshot: OfficeSnapshot): OfficeAnalysis {
  const subjectMap = buildSubjectMap(snapshot);
  const tableProfiles = buildTableProfiles(snapshot);
  const personJourneys = buildPersonJourneys(snapshot, tableProfiles);
  const fieldSummaries = snapshot.tables.flatMap((table) => allFields(table).map((field) => summarizeField(table, field)));
  const warnings: string[] = [];
  if (!subjectMap.workItem) warnings.push(`${subjectMap.mainTable}没有确认事项名称，页面会保留原始记录。`);
  if (subjectMap.people.length === 0) warnings.push(`${subjectMap.mainTable}没有确认负责人，暂时不能按人员查看。`);

  return {
    subjectMap,
    fieldSummaries,
    insights: buildInsights(snapshot, subjectMap, tableProfiles).slice(0, 8),
    tableProfiles,
    personJourneys,
    warnings,
  };
}
