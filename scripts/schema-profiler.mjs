#!/usr/bin/env node
/**
 * schema-profiler：扫描多维表格所有表/字段，生成「字段画像」。
 * 借鉴 Data Analytics analyze-data-quality 的思路（抄思路不抄代码）：
 * 用真实数据的统计特征描述每列（类型/去重数/空值率/样本值/数字汇总/日期范围），
 * 语义由数据自己说出来，不靠列名猜。
 */
import { execSync } from "node:child_process";

const LARK =
  process.env.LARK_CLI_BIN ||
  process.env.LARK_CLI_PATH ||
  (process.platform === "win32" ? "lark-cli.cmd" : "lark-cli");

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? String(argv[i + 1]) : "";
};
const base = flag("--base");

if (!base) {
  console.error("用法: node scripts/schema-profiler.mjs --base <base_token>");
  process.exit(1);
}

function run(cmd) {
  return execSync(cmd, { encoding: "utf8", timeout: 120000, shell: "cmd.exe" }).trim();
}

function norm(v) {
  if (v == null) return null;
  if (Array.isArray(v)) {
    if (v.length === 0) return null;
    const parts = v.map((x) =>
      x && typeof x === "object" ? String(x.name ?? x.text ?? x.id ?? "") : String(x),
    );
    return parts.filter(Boolean).join("、");
  }
  if (typeof v === "object") return String(v.name ?? v.text ?? v.id ?? "");
  return String(v);
}

function profileField(name, type, values, total) {
  const nonNull = values.filter((v) => v !== null && String(v).trim() !== "");
  const nullRate = total > 0 ? (total - nonNull.length) / total : 0;
  const distinct = new Map();
  for (const v of nonNull) {
    distinct.set(String(v), (distinct.get(String(v)) || 0) + 1);
  }
  const topValues = [...distinct.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([v, c]) => ({ value: v, count: c }));

  const p = {
    field: name,
    type,
    nullRate: Number(nullRate.toFixed(2)),
    nonNull: nonNull.length,
    distinctCount: distinct.size,
    topValues,
  };
  if (type === "number") {
    const nums = nonNull.map(Number).filter((n) => Number.isFinite(n));
    if (nums.length) {
      p.number = {
        min: Math.min(...nums),
        max: Math.max(...nums),
        avg: Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2)),
      };
    }
  }
  if (type === "datetime" || type === "created_at" || type === "updated_at") {
    const dates = nonNull.map((s) => (s.match(/^\d{4}-\d{2}-\d{2}/) || [""])[0]).filter(Boolean);
    if (dates.length) {
      const sorted = [...dates].sort();
      p.date = { min: sorted[0], max: sorted[sorted.length - 1] };
    }
  }
  return p;
}

function readTable(baseToken, tableId, tableName) {
  const fr = run(`${LARK} base +field-list --base-token ${baseToken} --table-id ${tableId} --as user --format json`);
  const fields = JSON.parse(fr).data.fields.map((f) => ({ name: f.name, type: f.type }));

  const rr = run(`${LARK} base +record-list --base-token ${baseToken} --table-id ${tableId} --limit 200 --as user --format json`);
  const rd = JSON.parse(rr).data;
  const rows = [];
  for (let i = 0; i < (rd.data || []).length; i++) {
    const row = {};
    for (let j = 0; j < rd.fields.length; j++) row[rd.fields[j]] = rd.data[i][j];
    rows.push(row);
  }

  return {
    tableId,
    tableName,
    recordCount: rows.length,
    hasMore: rd.has_more === true,
    fields: fields.map((f) => profileField(f.name, f.type, rows.map((r) => norm(r[f.name])), rows.length)),
  };
}

const tablesRaw = run(`${LARK} base +table-list --base-token ${base} --as user --format json`);
const tables = JSON.parse(tablesRaw).data.tables;

const result = {
  baseToken: base,
  tables: tables.map((t) => readTable(base, t.id, t.name)),
};
console.log(JSON.stringify(result, null, 2));
