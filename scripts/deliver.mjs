#!/usr/bin/env node
/**
 * Office Live 一键交付脚本
 *
 * 用法：
 *   node scripts/deliver.mjs --base <表格链接或base_token> --admin <管理员姓名> [--code <管理口令>]
 *       --task-table <页面主入口表名> [--member-table <人员档案表名>] [--project-table <项目表名>]
 *       --owner-field <负责人列名> --name-field <事项名称列名>
 *
 * 流程（全自动，10-15 分钟）：
 *   ① 读取表格结构+数据（并行）
 *   ② 分析：表/字段/人数/任务统计/异常
 *   ③ 生成 lib/office-config.ts（自动替换）
 *   ④ 本地启动准备：复制模板到独立目录、basePath 置空、输出启动指引
 *   ⑤ 验证：读表确认授权与数据可用
 *
 * 前提：lark-cli 已登录（--as user）、当前目录是 skill 仓库根或页面模板目录。
 * 本地模式（方案 C）：不创建任何应用、不发布、不部署——页面直接在本机运行。
 * 用法示例：
 *   node scripts/deliver.mjs --base <base_token> --admin <管理员姓名> --task-table 任务清单 --member-table 人员档案 --project-table 项目总览 --owner-field 负责人 --name-field 任务名称
 */

import { execSync, execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";

// lark-cli 调用：与页面（lark-bridge）用【同一套解析】——保证授权只落在一个实例，扫码一次、处处生效。
// 优先级：LARK_CLI_BIN / LARK_CLI_PATH 显式指定 > Windows 下 lark-cli.cmd（npm版：支持auth授权、路径无空格Node可调用）> PATH 里的 lark-cli。
// 绝不硬编码某台机器的绝对路径或 profile——lark 认证环境（LARK_CHANNEL_HOME/PROFILE/CONFIG）全部从运行环境继承。
const LARK =
  process.env.LARK_CLI_BIN ||
  process.env.LARK_CLI_PATH ||
  (process.platform === "win32" ? "lark-cli.cmd" : "lark-cli");
// lark 相关环境变量不写死：运行环境已配置（登录 profile）则原样继承；
// 未配置时由 lark-cli 自身按默认机制解析（如 ~/.lark-channel 等）。
const larkEnv = {};

function resolveLarkBin() {
  // 已显式指定绝对路径（含分隔符）直接用；否则用 where/which 解析出绝对路径。
  // 共性防护（Windows/Mac 都适用）：Node 的 exec 无法调用含空格的路径（已实测），
  // 因此优先选「路径不含空格且带可执行扩展名」的候选，确保页面服务（独立进程）
  // 与 deliver.mjs 用同一个 lark-cli，授权一次处处生效。
  if (/[\\\/]/.test(LARK)) return LARK;
  try {
    const cmd = process.platform === "win32" ? "where " + LARK : "which " + LARK;
    const outs = execSync(cmd, { encoding: "utf8" }).trim().split(/\r?\n/).filter(Boolean);
    const noSpaceExe = outs.find((p) => !/\s/.test(p) && /\.(cmd|exe|bat)$/i.test(p));
    const noSpace = outs.find((p) => !/\s/.test(p));
    return noSpaceExe || noSpace || outs.at(0) || LARK;
  } catch {
    return LARK;
  }
}

function run(cmd, opts = {}) {
  const env = { ...process.env, ...larkEnv, ...(opts.env || {}) };
  return execSync(cmd, {
    encoding: "utf8",
    env,
    cwd: opts.cwd || process.cwd(),
    stdio: opts.stdio || "pipe",
    timeout: opts.timeout || 120000,
  }).trim();
}

// Windows 下 .cmd/.bat 不能直接 spawn（execFile 会报 EINVAL），须经 cmd.exe 执行。
// 授权 URL 含 & 等 cmd 特殊字符：直接传会被 cmd 当命令分隔符截断；^& 转义经 .cmd 批处理会残留 ^。
// 最干净做法：把 URL 放进环境变量，命令行只写 %QR_URL%，cmd 展开后 & 不会被重新解析（跨 win/mac 兼容）。
function runQrcode(bin, args, opts = {}) {
  const env = { ...process.env, ...larkEnv, ...(opts.env || {}) };
  const timeout = opts.timeout || 30000;
  const isCmd = /\.(cmd|bat)$/i.test(bin);
  if (isCmd) {
    const urlIdx = args.findIndex((a) => /^https?:\/\//i.test(a));
    if (urlIdx >= 0) {
      env.QR_URL = args[urlIdx];
      args = args.map((a, i) => (i === urlIdx ? "%QR_URL%" : a));
    }
    // %QR_URL% 必须加双引号：cmd 展开成 "url" 后 & 被引号保护，不会被当命令分隔符
    const parts = args.map((a) => {
      if (a === "%QR_URL%") return '"%QR_URL%"';
      return /[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a;
    });
    const cmdline = `"${bin}" ${parts.join(" ")}`;
    return execSync(cmdline, { encoding: "utf8", timeout, ...(opts.cwd ? { cwd: opts.cwd } : {}), env });
  }
  // Mac/Linux：execFileSync 不经 shell，URL 里的 & 天然安全
  return execFileSync(bin, args, { encoding: "utf8", timeout, ...(opts.cwd ? { cwd: opts.cwd } : {}), env });
}

function larkCmd(args) {
  const bin = /\s/.test(LARK) ? `"${LARK.replace(/"/g, '\\"')}"` : LARK;
  return `${bin} ${args}`;
}

function authStatus() {
  const raw = run(larkCmd("auth status --json --verify"), { timeout: 15000 });
  return JSON.parse(raw);
}

function step(name, ms) {
  console.log(`\n[${(ms / 1000).toFixed(1)}s] === ${name} ===`);
}

function isPortFree(port) {
  return new Promise((resolveFree) => {
    const server = createServer();
    server.once("error", () => resolveFree(false));
    server.once("listening", () => {
      server.close(() => resolveFree(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function pickLocalPort() {
  const preferred = Number.parseInt(process.env.OFFICE_LIVE_PORT || process.env.PORT || "3000", 10);
  const start = Number.isFinite(preferred) && preferred > 0 ? preferred : 3000;
  for (let port = start; port < start + 20; port++) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(`本地端口 ${start}-${start + 19} 都不可用，请关闭旧服务后重试。`);
}

function defaultOutputRoot() {
  // 产物默认统一写到用户文档目录：任何 agent / 任何安装位置都不落进 skill 目录，
  // 不依赖当前 skill 装在哪个路径；可用 OFFICE_LIVE_OUTPUT_DIR 显式覆盖。
  if (process.env.OFFICE_LIVE_OUTPUT_DIR) return resolve(process.env.OFFICE_LIVE_OUTPUT_DIR);
  return join(homedir(), "Documents", "office-live-output");
}

const started = Date.now();
function extractBaseToken(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  const tokenMatch = raw.match(/(?:base\/|base_token=|app_token=)([A-Za-z0-9]+)/i);
  if (tokenMatch?.[1]) return tokenMatch[1];
  const pathMatch = raw.match(/\/base\/([A-Za-z0-9]+)/i);
  if (pathMatch?.[1]) return pathMatch[1];
  return raw;
}

// ── 参数解析：页面主入口表与列名全部由用户确认传入，脚本绝不自动决定关键写回入口 ────
// 用法:
//   node scripts/deliver.mjs --base <表格链接或base_token> --admin <管理员姓名> [--code <管理口令>]
//       --task-table <页面主入口表名> [--member-table <人员档案表名>] [--project-table <项目表名>]
//       --owner-field <负责人列名> --name-field <事项名称列名>
// 没有独立人员表/项目表时，省略对应 --member-table / --project-table 即可（成员从主入口表负责人列聚合）。
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? String(argv[i + 1]) : "";
};
const baseInput = flag("--base");
const base = extractBaseToken(baseInput);
const ownerName = flag("--admin");
// 管理口令：可选；未传则默认取多维表格真名（在读取表格结构后填充）
let adminCode = flag("--code");
// 页面主入口（交付确认环节由用户确认）：主入口表必填；人员表/项目表可选；未选表自动作为 data 参与全量分析
const taskTableNameArg = flag("--task-table");
const memberTableNameArg = flag("--member-table");
const projectTableNameArg = flag("--project-table");
// 列名（完全按用户确认的列名使用，不做任何映射/猜测）
const ownerFieldOverride = flag("--owner-field");
const nameFieldOverride = flag("--name-field");

// 页面根目录自动定位：
//  - 若在 skill 仓库根运行（cwd 无 lib/，但 cwd/templates/page/ 有）→ 以 templates/page 为页面根
//  - 若直接 cd 到页面模板目录运行 → 以 cwd 为页面根
const cwdHasPage = existsSync(join(process.cwd(), "lib", "office-config.ts"));
const cwdTemplatePage = join(process.cwd(), "templates", "page");
const pageRoot = cwdHasPage
  ? process.cwd()
  : existsSync(join(cwdTemplatePage, "lib", "office-config.ts"))
    ? cwdTemplatePage
    : process.cwd();
if (!cwdHasPage && pageRoot === process.cwd()) {
  console.warn("⚠️ 未找到页面模板目录（lib/office-config.ts）。请确认在 skill 仓库或模板目录中运行。");
}

if (!base || !ownerName || !taskTableNameArg || !ownerFieldOverride || !nameFieldOverride) {
  console.error("用法: node scripts/deliver.mjs --base <表格链接或base_token> --admin <管理员姓名> [--code <管理口令>] --task-table <页面主入口表名> [--member-table <人员档案表名>] [--project-table <项目表名>] --owner-field <负责人列名> --name-field <事项名称列名>");
  process.exit(1);
}

try {
  // ── ⓪ 检查飞书表格授权；未授权则弹出授权链接（用户扫码一次即可）────
  let authorizedUser = "";
  step("检查飞书表格授权", 0);
  let needLogin = false;
  // 读表实测：任何 lark-cli 都能用（不依赖 auth 命令），作为授权探测的兜底
  const readProbeOk = () => {
    try {
      run(larkCmd(`base +table-list --base-token ${base} --as user --json`), { timeout: 30000 });
      return true;
    } catch {
      return false;
    }
  };
  const authCmdUnsupported = (e) => /unknown command|not a command|invalid command/i.test(String(e.message || e));
  try {
    const auth = authStatus();
    const userAuth = auth.identities?.user;
    const okStatuses = ["ready", "needs_refresh"]; // needs_refresh 下次调用自动恢复，视为已授权
    if (userAuth?.userName) authorizedUser = userAuth.userName;
    if (userAuth && okStatuses.includes(userAuth.status)) {
      console.log("飞书表格授权已就绪（" + (userAuth.userName || "未知账号") + "）。");
    } else if (readProbeOk()) {
      // user 身份缺失/状态异常，但读表实测能读到数据 → 视为已授权
      console.log("（auth status 提示未就绪，但读表实测通过，视为已授权）");
    } else {
      needLogin = true;
    }
  } catch (e) {
    // auth 命令不可用（如 unknown command）或 auth status 异常：
    // 绝不静默跳过——改用读表实测探测授权（任何 lark-cli 都适用）。
    if (readProbeOk()) {
      console.log("（auth status 不可用，读表实测通过：授权已就绪）");
    } else {
      needLogin = true;
    }
  }
  if (needLogin) {
    // 未授权 / 已登出 / 授权过期：明确提示并尝试发起扫码授权
    console.log("未检测到飞书表格授权（已登出或授权过期）。正在发起授权…");
    try {
      const loginRaw = run(larkCmd("auth login --domain base --no-wait --json"), { timeout: 30000 });
      const login = JSON.parse(loginRaw);
      const url = login.verification_uri_complete || login.verification_url || "";
      const deviceCode = login.device_code || "";
      if (!url || !deviceCode) throw new Error(`授权发起失败: ${loginRaw.slice(0, 300)}`);
      // 二维码：PNG 图片 + ASCII 双保险；授权 URL 含 & 等字符，必须绕过 shell 传参
      // （cmd 会把 & 当命令分隔符导致链接被截断），故用 execFileSync 以参数数组方式调用。
      const authDir = join(tmpdir(), "office-live-auth");
      mkdirSync(authDir, { recursive: true });
      const qrFile = `office-live-auth-${Date.now()}.png`;
      const qrPath = join(authDir, qrFile);
      const larkBin = resolveLarkBin();
      try {
        runQrcode(larkBin, ["auth", "qrcode", url, "--output", qrFile], { cwd: authDir });
      } catch (e) {
        console.log("（二维码图片生成失败，改用链接）:", e.message);
      }
      let asciiQr = "";
      try {
        asciiQr = runQrcode(larkBin, ["auth", "qrcode", url, "--ascii"]).toString();
      } catch { /* ASCII 失败不阻塞，链接兜底 */ }
      console.log("\n======================================================");
      console.log("  需要您扫码完成飞书表格读写授权（约 10 秒）：");
      if (existsSync(qrPath)) console.log(`  📱 二维码图片：${qrPath}`);
      if (asciiQr.trim()) console.log("  ASCII 二维码：\n" + asciiQr);
      console.log(`  🔗 点击授权链接：${url}`);
      console.log("\n  完成授权后，请先让 agent 执行以下【令牌兑换】命令（一次即可，不用再扫码）：");
      console.log(`    ${LARK} auth login --device-code ${deviceCode} --domain base`);
      console.log("  兑换成功后 agent 执行 auth status --verify 确认已就绪，再重跑同一条 deliver.mjs 命令。");
      console.log("======================================================\n");
      process.exit(2);
    } catch (e) {
      if (authCmdUnsupported(e)) {
        console.error("\n当前 lark-cli 不支持 auth 命令，无法自动发起扫码授权。");
        console.error("请改用支持 auth 命令的 lark-cli（npm 版），手动执行：lark-cli auth login --domain base");
        console.error("完成扫码授权后，重新运行同一条 deliver.mjs 命令。\n");
        process.exit(2);
      }
      throw e;
    }
  }

  // ── ⓪.5 一次性预检：把会导致中途停下的问题尽早暴露 ─────────────
  step("交付预检", Date.now() - started);
  const preflightIssues = [];
  // 方案 C（本地模式）：全程用客户扫码授权的 lark-cli 用户身份，无需任何应用凭证
  if (!ownerFieldOverride) preflightIssues.push("缺少负责人字段名：请用 --owner-field 传入用户确认的列名。");
  if (!nameFieldOverride) preflightIssues.push("缺少事项名称字段名：请用 --name-field 传入用户确认的列名。");
  if (!taskTableNameArg) preflightIssues.push("缺少页面主入口表名：请用 --task-table 传入用户确认的表名。");
  if (preflightIssues.length > 0) {
    throw new Error(`交付预检未通过：\n- ${preflightIssues.join("\n- ")}`);
  }
  console.log("预检通过：登录态、页面主入口表、负责人字段、事项名称字段已齐。");

  // ── ① 读取表格结构 ──────────────────────────────
  step("读取表格结构", Date.now() - started);
  // 拿多维表格真名（管理口令默认取它；也用于页面标题展示）
  let baseRealName = "";
  try {
    const baseGetRaw = run(larkCmd(`base +base-get --base-token ${base} --as user --json`));
    baseRealName = JSON.parse(baseGetRaw).data?.base?.name || "";
  } catch { /* 拿不到就用主入口表名兜底 */ }
  if (!adminCode) adminCode = baseRealName || base; // 未传口令：默认=多维表格真名
  console.log("多维表格名:", baseRealName || "(未知)", "| 管理口令:", adminCode === base ? "(未设置,默认base)" : adminCode);
  const tablesRaw = run(larkCmd(`base +table-list --base-token ${base} --as user --json`));
  const tables = JSON.parse(tablesRaw).data.tables;
  const tableMap = {};
  for (const t of tables) tableMap[t.name] = t.id;
  console.log("表:", tables.map((t) => `${t.name}(${t.records_count}条)`).join(" | "));

  // ── ② 主入口确认：关键交互入口由用户确认，其他表自动进入全量分析 ────
  step("确认主入口与全量表", Date.now() - started);
  // 先读取每张表的字段，展示给 Agent/用户确认（"有什么就分析什么"）

  // 读所有表字段
  const tableSchemas = [];
  for (const t of tables) {
    let fields = [];
    let fieldTypes = {};
    let fieldOptions = {};
    try {
      const fr = run(larkCmd(`base +field-list --base-token ${base} --table-id ${t.id} --as user --json`));
      const fl = JSON.parse(fr).data.fields;
      fields = fl.map((f) => f.name);
      fieldTypes = Object.fromEntries(fl.map((f) => [f.name, f.type]));
      // select 选项：写回校验 + 生命周期列判定（与页面 feishu-office resolveMainSemantics 同源）都要用
      fieldOptions = Object.fromEntries(
        fl.filter((f) => Array.isArray(f.options) && f.options.length > 0).map((f) => [f.name, f.options.map((o) => o.name)]),
      );
    } catch { /* ignore */ }
    tableSchemas.push({ id: t.id, name: t.name, fields, fieldTypes, fieldOptions, count: t.records_count });
  }
  for (const ts of tableSchemas) {
    console.log(`表 ${ts.name}: ${ts.fields.join(" | ")}`);
  }

  // 按用户确认的表名解析角色（找不到就明确报错，并列出当前所有表名）
  const resolveTable = (name, role) => {
    if (!name || name === "-" || name === "无" || name === "none" || name === "N/A") return null;
    const hit = tableSchemas.find((s) => s.name === name);
    if (!hit) {
      throw new Error(
        `找不到「${role}」表「${name}」。当前多维表格里的表：${tableSchemas.map((s) => s.name).join("、")}。请与用户确认正确表名后重试。`,
      );
    }
    return hit;
  };
  const taskEntry = resolveTable(taskTableNameArg, "任务");
  const memberEntry = resolveTable(memberTableNameArg, "人员档案");
  const projectEntry = resolveTable(projectTableNameArg, "项目");
  const taskTable = taskEntry.id;
  const taskTableName = taskEntry.name;
  const memberTable = memberEntry?.id || null;
  const memberTableName = memberEntry?.name || "";
  const projectTable = projectEntry?.id || null;
  const projectTableName = projectEntry?.name || "";
  console.log(
    "页面主入口表:", taskTableName,
    "| 人员表:", memberTableName || "无（成员从任务负责人聚合）",
    "| 项目表:", projectTableName || "无",
  );

  // ── ② 读取数据（并行）───────────────────────────
  step("读取数据", Date.now() - started);
  const readRec = (tid) =>
    JSON.parse(
      run(larkCmd(`base +record-list --base-token ${base} --table-id ${tid} --limit 200 --as user --json`)),
    );
  // 主入口表承载"人+事"交互；有独立人员表则读档案，无则成员从主入口表负责人列聚合
  const taskData = readRec(taskTable);
  const memberData = memberTable ? readRec(memberTable) : null;

  const tFields = taskData.data.fields;
  const tRows = taskData.data.data;
  const taskFieldTypes = taskEntry.fieldTypes || {};
  console.log("主入口表字段:", tFields.join(" | "));

  // 识别字段（客户表有什么就映射什么：按语义选，不预设名称）
  const pick = (cands) => {
    for (const c of cands) {
      const i = tFields.indexOf(c);
      if (i >= 0) return { idx: i, name: c };
    }
    return null;
  };
  // 主入口表字段语义：名称（事）、人（主角）、状态、分组（归属）、时间、数字
  // 事项名称字段：用户确认的字段优先（第 6 参）；未提供才用候选词兜底。
  // 用户指定优先，候选词仅为"未指定时"的兜底，绝不预设——任何列名用户说了算。
  let fName = nameFieldOverride
    ? (tFields.includes(nameFieldOverride) ? { idx: tFields.indexOf(nameFieldOverride), name: nameFieldOverride } : null)
    : pick(["任务名称", "订单号", "销售单号", "工单编号", "单号", "事项", "任务", "标题", "名称", "客户名称", "商品", "品名", "项目名称", "Title", "Task", "Name", "内容", "单据"]);
  if (nameFieldOverride && !fName) {
    throw new Error(`您指定的事项名称字段「${nameFieldOverride}」不在该表中（表字段：${tFields.join("、")}）。请确认字段名后重试。`);
  }
  if (fName && nameFieldOverride) console.log(`已按用户确认使用事项名称字段: ${fName.name}（跳过自动识别）`);
  // 负责人字段：用户确认的字段优先（第 5 参）；未提供才自动识别（按候选顺序）。
  // 自动识别只作为兜底——交付确认环节用户可改选任意人员字段（如"经办人"），
  // 通过第 5 参传入后，工位聚合、写回、旅程全部按该字段走。
  let fOwner = ownerFieldOverride
    ? (tFields.includes(ownerFieldOverride) ? { idx: tFields.indexOf(ownerFieldOverride), name: ownerFieldOverride } : null)
    : pick(["负责人", "销售员", "烘焙师", "经办人", "店长", "成员", "处理人", "接待员", "客服", "销售", "Assignee", "Owner", "联系人", "对接人", "店员", "姓名"]);
  if (ownerFieldOverride && !fOwner) {
    throw new Error(`您指定的负责人字段「${ownerFieldOverride}」不在该表中（表字段：${tFields.join("、")}）。请确认字段名后重试。`);
  }
  if (fOwner && ownerFieldOverride) console.log(`已按用户确认使用负责人字段: ${fOwner.name}（跳过自动识别）`);
  // ── 辅助语义识别：画像驱动（认数据不认词）──
  // 任何表：先用真实数据构建字段画像（类型/去重数/样本值），语义由数据自己显现——
  // 不再用列名词表猜测（列名千奇百怪，词表永远有盲区）。
  // 关键列（事项名称/负责人）仍由用户确认传入，不在此列。
  const tf = taskFieldTypes;
  const byType = (types) => tFields.filter((f) => types.includes(tf[f]));
  const selCols = byType(["select"]); // 选项列（单选/多选）
  const dateCols = byType(["datetime"]); // 日期列
  const numCols = byType(["number"]); // 数字列
  const linkCols = byType(["link"]); // 关联列
  const textCols = byType(["text"]); // 文本列
  const userCols = byType(["user"]); // 人员列
  const toPick = (name) => (name ? { idx: tFields.indexOf(name), name } : null);

  // 从任务表真实记录构建画像：每列的去重数/样本值（语义判定依据）
  const tRowValues = (tRows || []).map((row) => {
    const o = {};
    for (let j = 0; j < tFields.length; j++) o[tFields[j]] = row[j];
    return o;
  });
  const normV = (v) => {
    if (v == null) return "";
    if (Array.isArray(v)) {
      if (v.length === 0) return "";
      const p = v.map((x) => (x && typeof x === "object" ? String(x.name ?? x.text ?? x.id ?? "") : String(x)));
      return p.filter(Boolean).join("、");
    }
    if (typeof v === "object") return String(v.name ?? v.text ?? v.id ?? "");
    return String(v);
  };
  const fieldProfile = (fname) => {
    const vals = tRowValues.map((r) => normV(r[fname])).filter((v) => v !== "");
    const distinct = new Map();
    for (const v of vals) distinct.set(v, (distinct.get(v) || 0) + 1);
    const top = [...distinct.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    return {
      field: fname,
      type: tf[fname],
      nonNull: vals.length,
      distinctCount: distinct.size,
      topValues: top.map(([value, count]) => ({ value, count })),
    };
  };
  const profiles = tFields.map(fieldProfile);
  // 画像语义分类：user=人员；select 去重2~12=状态；number 0~1=完成度；datetime=日期；link=关联
  const sem = (fname) => {
    const p = profiles.find((x) => x.field === fname);
    if (!p) return undefined;
    if (p.type === "user") return "person";
    if (p.type === "select") return p.distinctCount >= 2 && p.distinctCount <= 12 ? "status" : "category";
    if (p.type === "number") {
      const nums = p.topValues.map((t) => Number(t.value)).filter(Number.isFinite);
      if (nums.length && Math.max(...nums) <= 1 && Math.min(...nums) >= 0) return "percent";
      return "measure";
    }
    if (p.type === "datetime") return "datetime";
    if (p.type === "link") return "link";
    if (p.type === "text") return p.distinctCount >= p.nonNull * 0.8 ? "text" : "category";
    return "text";
  };
  const semFields = (s) => tFields.filter((f) => sem(f) === s);
  // 同类多列时的名称消歧（只用于"多个同类型候选里选哪个"，不做语义猜测）
  const hint = (cols, words) =>
    cols.find((f) => words.some((w) => f.toLowerCase().includes(w.toLowerCase())));

  // 状态主列：值含「状态词」的短分类列（已/未/中/待/暂停/阻塞/完成/延期/规划/筹备——是"当前状态"，非流程步骤）。
  // 排除优先级值（P0/P1/P2…）——"P2 中"的"中"不是状态词。
  // 含状态词的列唯一 → 无歧义自动选；多个（客户状态/回款状态）→ 不自动选，页面画像展示全部状态列，不猜。
  const statusLike = (f) => {
    const p = profiles.find((x) => x.field === f);
    if (!p || p.type !== "select") return false;
    // 值整体是优先级/编号（P0/P1、S1、A类…）→ 不是状态
    const allPriority = p.topValues.length > 0 && p.topValues.every((t) => /^[PSABC]\d|^\d+[级类]|P0|P1|P2|P3|紧急|高|中|低/i.test(t.value));
    if (allPriority) return false;
    return p.topValues.some((t) => /已|未|中|待|暂停|阻塞|延期|完成|结束|规划|筹备|Done|Doing|Todo|Closed|Pending|Active|In Progress/i.test(t.value));
  };
  const statusBySem = semFields("status").filter(statusLike);
  const fStatus = toPick(statusBySem.length === 1 ? statusBySem[0] : null);
  // 截止：只认明确的「截止语义」列名（截止/结束/Due/Deadline/End/到期）。
  // 不猜"唯一日期列即截止"——事件/记录类日期（对接日期/发生日期/创建/更新）不是截止时间，
  // 误判会把"已发生的对接日期"标成超期。没有截止语义列就留空，页面不产生超期。
  const dateSem = semFields("datetime");
  // 强期限词优先：截止/到期/应还/还款/回款/下次/跟进/回访/预约/续约/计划完成/预计交付/Deadline/Due/Expire/结束
  // 刻意不用"完成/归还/交付/开始/创建"这类事件或历史词，避免把历史事实日期（归还日期/实际完成日期）误判成超期。
  const dueName = hint(dateSem, ["截止", "到期", "应还", "还款", "回款", "下次", "跟进", "回访", "预约", "续约", "计划完成", "预计交付", "Deadline", "Due", "Expire", "结束", "End"]);
  const fDue = toPick(dueName);
  // 项目：画像 link 列（被关联记录）；无则文本列含 项目/Project
  const linkSem = semFields("link");
  const fProject = toPick(
    linkSem.find((f) => /项目|Project|门店|区域|Store|Location/i.test(f)) || (linkSem.length === 1 ? linkSem[0] : null) || hint(textCols, ["项目", "Project", "门店", "区域", "Store", "Location"]),
  );
  // 优先级：选项列，画像 status 列中含 优先级/Priority
  const fPriority = toPick(hint(statusBySem, ["优先级", "Priority", "重要程度"]));
  // 类型：选项列含 类型/Type
  const fType = toPick(hint([...statusBySem, ...selCols], ["类型", "Type", "需求来源"]));
  // 描述：文本列含 描述/说明/内容/详情
  const fDesc = toPick(hint(textCols, ["描述", "说明", "内容", "详情", "Description"]));
  // 开始：日期列（除截止外）含 开始/Start
  const fStart = toPick(hint(dateCols.filter((f) => f !== fDue?.name), ["开始", "Start"]));
  // 完成：日期列（除截止/开始外）含 完成/Done/结束/实际
  const fDone = toPick(
    hint(
      dateCols.filter((f) => f !== fDue?.name && f !== fStart?.name),
      ["完成", "Done", "结束", "实际"],
    ),
  );
  // 阶段：选项列含 阶段/Stage
  const fStage = toPick(hint(statusBySem, ["阶段", "Stage", "里程碑"]));
  // 备注：文本列含 备注/Remark/评论
  const fRemark = toPick(hint(textCols, ["备注", "Remark", "评论", "Comment"]));
  // 数量/金额：数字列含 数量/金额/Count/Amount
  const fCount = toPick(hint(numCols, ["数量", "金额", "Count", "Amount", "Number"]));
  // 完成度：画像 percent 列（0~1 数字）第一个；无则数字列含 完成/进度/Percent/Ratio
  const percentBySem = semFields("percent");
  const fCompletion = toPick(percentBySem[0] || hint(numCols, ["完成", "进度", "Percent", "Ratio", "达成"]));

  if (!fName || !fOwner) {
    throw new Error(`主入口表缺少必要字段：事项名称(${fName?.name || "无"}) / 人员字段(${fOwner?.name || "无"})`);
  }
  // 用户确认的字段（负责人/状态/项目）一律用于读取和展示，不因字段类型拒绝。
  // 写回时再按字段真实类型处理：可写字段写入；只读计算/系统字段只展示并提示原因。
  console.log("字段映射:", `事项=${fName.name} 人员=${fOwner.name} 状态=${fStatus?.name || "-"} 时间=${fDue?.name || "-"} 分组=${fProject?.name || "-"} 数量=${fCount?.name || "-"}`);

  // 人数统计（从任务负责人聚合）
  const one = (v) => {
    if (v == null) return "";
    if (Array.isArray(v)) {
      if (v.length === 0) return "";
      const first = v[0];
      if (typeof first === "string") return first;
      if (first && typeof first === "object") {
        // link 字段: [{id, text?}] 或 {value:[...]}
        const obj = first;
        if (obj.text) return String(obj.text);
        if (obj.name) return String(obj.name);
        if (obj.value) return Array.isArray(obj.value) ? one(obj.value) : String(obj.value);
        return "";
      }
      return String(first);
    }
    if (typeof v === "object") {
      const obj = v;
      if (obj.text) return String(obj.text);
      if (obj.name) return String(obj.name);
      if (obj.value) return Array.isArray(obj.value) ? one(obj.value) : String(obj.value);
      return "";
    }
    return String(v);
  };
  const owners = {};
  for (const row of tRows) {
    const o = one(row[fOwner.idx]);
    if (o) owners[o] = (owners[o] || 0) + 1;
  }
  const people = Object.keys(owners);
  console.log(`有任务成员: ${people.length} 人 | 任务: ${tRows.length} 条`);

  // 状态统计
  const statusCount = {};
  if (fStatus) {
    for (const row of tRows) {
      const s = one(row[fStatus.idx]);
      if (s) statusCount[s] = (statusCount[s] || 0) + 1;
    }
  }
  console.log("状态分布:", JSON.stringify(statusCount));

  // ── ③ 生成配置（完整文件：含类型定义 + 配置 + 函数）──────
  step("生成 office-config.ts", Date.now() - started);

  // 构建表定义（字段映射：逻辑语义 -> 客户真实字段名；客户表有什么就映射什么）
  // 通用化：把客户表【所有字段】都保留（语义位映射 + 其余字段 extra_N 原样保留），
  // 页面按数据特征分析展示，不因字段不在清单而丢失。
  const tableDefs = [];
  {
    const semanticFields = {
      name: fName.name,
      owner: fOwner.name,
      ...(fStatus ? { status: fStatus.name } : {}),
      ...(fDue ? { due: fDue.name } : {}),
      ...(fProject ? { project: fProject.name } : {}),
      ...(fPriority ? { priority: fPriority.name } : {}),
      ...(fType ? { type: fType.name } : {}),
      ...(fDesc ? { description: fDesc.name } : {}),
      ...(fStart ? { start: fStart.name } : {}),
      ...(fDone ? { doneDate: fDone.name } : {}),
      ...(fStage ? { stage: fStage.name } : {}),
      ...(fRemark ? { remark: fRemark.name } : {}),
      ...(fCount ? { count: fCount.name } : {}),
      ...(fCompletion ? { completion: fCompletion.name } : {}),
    };
    // 其余字段：客户表里不在语义位里的，全部以 extra_N 保留（页面照样展示）
    const mapped = new Set(Object.values(semanticFields));
    let extraIdx = 0;
    for (const f of tFields) {
      if (!mapped.has(f)) {
        semanticFields[`extra_${extraIdx++}`] = f;
      }
    }
    tableDefs.push({
      id: taskTable,
      role: "tasks",
      title: taskTableName || "事项",
      fields: semanticFields,
    });
  }
  if (memberTable) {
    const mFields = memberData?.data?.fields || [];
    // 类型驱动（与任务表同思路）：词表仅作同类型多列消歧，不决定能否识别
    const mTypes = {};
    try {
      const fr = run(larkCmd(`base +field-list --base-token ${base} --table-id ${memberTable} --as user --json`));
      for (const f of JSON.parse(fr).data.fields) mTypes[f.name] = f.type;
    } catch { /* ignore */ }
    const pickMem = (cands) => cands.find((c) => mFields.includes(c));
    const hintMem = (words) => mFields.find((f) => words.some((w) => f.toLowerCase().includes(w.toLowerCase())));
    const numMem = mFields.filter((f) => mTypes[f] === "number" || mTypes[f] === "lookup" || mTypes[f] === "formula");
    const selMem = mFields.filter((f) => mTypes[f] === "select");
    // 成员姓名：画像驱动——user 类型列（人员字段）就是姓名来源（不靠列名猜）；
    // 无 user 列才用名称消歧；绝不取 auto_number 编号列当姓名。
    const userMem = mFields.filter((f) => mTypes[f] === "user");
    const fMemName =
      (userMem.length === 1 ? userMem[0] : null) ||
      pickMem(["人员姓名", "姓名", "成员姓名", "Name", "名字"]) ||
      hintMem(["姓名", "名字", "Name"]) ||
      mFields[0] || "姓名";
    const fMemRole = pickMem(["角色", "职位", "Role", "岗位"]) || hintMem(["角色", "职位", "岗位", "Role"]) || (selMem.length === 1 ? selMem[0] : null);
    const fMemLevel = pickMem(["职级", "级别", "Level"]) || hintMem(["职级", "级别", "Level"]);
    const fMemSkills = pickMem(["技能标签", "技能", "Skills", "专长"]);
    const fMemNo = pickMem(["工号", "员工编号", "Employee No", "编号"]) || hintMem(["工号", "编号", "No"]);
    // 统计列（完成度/任务数等）：类型驱动 + 名称消歧——客户表有就映射，「表有值取表、没有才计算」
    const fMemCompletion = pickMem(["完成度", "完成率", "进度", "Completion", "Percent"]) || hintMem(["完成", "进度", "Percent", "Ratio", "达成"]);
    const fMemTotal = pickMem(["任务数", "总任务数", "任务总数", "Total Tasks", "Total"]) || hintMem(["任务数", "总任务", "Total"]);
    const fMemTodo = pickMem(["待办数", "待办任务数", "Todo"]) || hintMem(["待办", "Todo"]);
    const fMemActive = pickMem(["进行中数", "进行中任务数", "Active", "进行中"]) || hintMem(["进行中", "Active"]);
    const fMemDone = pickMem(["已完成数", "已完成任务数", "Done", "已完成"]) || hintMem(["已完成", "Done"]);
    const fMemOverdue = pickMem(["超期数", "超期任务数", "Overdue", "超期"]) || hintMem(["超期", "Overdue"]);
    // 统计列只在数字/计算类列里找（避免把文本列当统计）
    const statOk = (f) => (f ? numMem.includes(f) : false);
    tableDefs.push({
      id: memberTable,
      role: "members",
      title: memberTableName || "人员",
      fields: {
        name: fMemName,
        ...(fMemRole ? { role: fMemRole } : {}),
        ...(fMemLevel ? { level: fMemLevel } : {}),
        ...(fMemSkills ? { skills: fMemSkills } : {}),
        ...(fMemNo ? { employeeNo: fMemNo } : {}),
        ...(statOk(fMemCompletion) ? { completion: fMemCompletion } : {}),
        ...(statOk(fMemTotal) ? { total: fMemTotal } : {}),
        ...(statOk(fMemTodo) ? { todo: fMemTodo } : {}),
        ...(statOk(fMemActive) ? { active: fMemActive } : {}),
        ...(statOk(fMemDone) ? { done: fMemDone } : {}),
        ...(statOk(fMemOverdue) ? { overdue: fMemOverdue } : {}),
      },
    });
  }
  if (projectTable) {
    let pFields = [];
    let pTypes = {};
    try {
      const pl = JSON.parse(
        run(larkCmd(`base +record-list --base-token ${base} --table-id ${projectTable} --limit 1 --as user --json`)),
      );
      pFields = pl.data.fields;
      const pf = JSON.parse(run(larkCmd(`base +field-list --base-token ${base} --table-id ${projectTable} --as user --json`)));
      for (const f of pf.data.fields) pTypes[f.name] = f.type;
    } catch { /* ignore */ }
    const pickProj = (cands) => cands.find((c) => pFields.includes(c));
    const hintProj = (words) => pFields.find((f) => words.some((w) => f.toLowerCase().includes(w.toLowerCase())));
    // 项目表所有字段都会进入全量表详情；这里仅为项目摘要挑选可安全展示为进度/状态的字段。
    const readOnlyTypesSet = new Set(["lookup", "formula", "rollup", "auto_number", "created_by", "modified_by", "created_time", "modified_time", "button", "group"]);
    const numProj = pFields.filter((f) => pTypes[f] === "number");
    const selProj = pFields.filter((f) => pTypes[f] === "select");
    const fProjName = pickProj(["项目名称", "项目", "Project", "Name"]) || pFields[0] || "项目名称";
    const fProjStatus = pickProj(["项目状态", "状态", "Status"]) || hintProj(["状态", "Status"]) || (selProj.length === 1 ? selProj[0] : null);
    const fProjPriority = pickProj(["优先级", "Priority"]) || hintProj(["优先级", "Priority"]);
    // 项目完成度：只选 0~1 的 percent 数字列（如"项目完成度"）；没有就不配 progress（页面不显示进度）。
    // 绝不拿唯一数字列兜底（项目预算/已发生成本不是进度，误配会把金额当百分比显示）。
    const pNumProfile = (fname) => {
      const rr = JSON.parse(run(larkCmd(`base +record-list --base-token ${base} --table-id ${projectTable} --limit 200 --as user --json`)));
      const rd = rr.data;
      const vals = [];
      for (let i = 0; i < (rd.data || []).length; i++) {
        const idx = rd.fields.indexOf(fname);
        if (idx >= 0) {
          const v = rd.data[i][idx];
          const n = typeof v === "number" ? v : Number(String(v ?? "").replace("%", ""));
          if (Number.isFinite(n)) vals.push(n);
        }
      }
      return vals;
    };
    const percentProj = numProj.filter((f) => {
      const vals = pNumProfile(f);
      return vals.length > 0 && Math.max(...vals) <= 1 && Math.min(...vals) >= 0;
    });
    const fProjProgress =
      (percentProj.length === 1 ? percentProj[0] : null) ||
      percentProj.find((f) => /完成|进度|Percent|Ratio|达成/.test(f)) ||
      undefined;
    const fProjDue = pickProj(["计划完成日期", "计划日期", "Due Date", "Due"]) || hintProj(["计划", "完成日期", "Due", "截止", "到期"]);
    const projOk = (f) => (f ? numProj.includes(f) || pTypes[f] === "number" : false);
    tableDefs.push({
      id: projectTable,
      role: "projects",
      title: projectTableName || "项目",
      fields: {
        name: fProjName,
        ...(fProjStatus ? { status: fProjStatus } : {}),
        ...(fProjPriority ? { priority: fProjPriority } : {}),
        ...(projOk(fProjProgress) ? { progress: fProjProgress } : {}),
        ...(fProjDue ? { dueDate: fProjDue } : {}),
      },
    });
  }

  const configuredIds = new Set(tableDefs.map((table) => table.id));
  for (const schema of tableSchemas) {
    if (configuredIds.has(schema.id)) continue;
    // data 表（未被选为任务/人员/项目的表）：自动识别一个"名称"列作为 name 映射，
    // 供关联字段（link）解析成可读名称；识别不到就保持空（页面显示原值，不编造）。
    const dTypes = schema.fieldTypes || {};
    const dataTextCols = schema.fields.filter((f) => dTypes[f] === "text");
    const dataNameField =
      hint(dataTextCols, ["名称", "标题", "书名", "品名", "名字", "主题", "姓名", "项目", "商品", "客户", "Name", "Title", "Book"]) ||
      (dataTextCols.length === 1 ? dataTextCols[0] : null);
    tableDefs.push({
      id: schema.id,
      role: "data",
      title: schema.name,
      fields: dataNameField ? { name: dataNameField } : {},
    });
  }

  const config = `/**
 * Office Live · 飞书表配置（自动生成）
 * 每次交付只改本文件；换客户表格 = 换配置，代码不动。
 */

export type OfficeFieldMap = Record<string, string>;

export interface OfficeTableConfig {
  /** 表 ID */
  id: string;
  /** 表名（页面展示用，客户表叫什么就显示什么） */
  title?: string;
  /** 表角色：tasks / members / projects / risks / milestones / data */
  role: "tasks" | "members" | "projects" | "risks" | "milestones" | "data";
  /** 逻辑语义 -> 真实字段名 */
  fields: OfficeFieldMap;
}

export interface OfficeBaseConfig {
  baseToken: string;
  baseTitle: string;
  /** 表格维护人（负责人） */
  ownerName: string;
  /** 管理口令：改动表格前需输入（默认取表格名） */
  adminCode?: string;
  /** A2: 客户 token 存储位置 */
  tokenStore?: "miaoda-db" | "env" | "tenant";
  /** A2: token 刷新回调地址 */
  tokenRefreshUrl?: string;
  tables: OfficeTableConfig[];
}

export const OFFICE_CONFIG: OfficeBaseConfig = {
  baseToken: "${base}",
  baseTitle: "${baseRealName || (tables[0]?.name || "Office Live")}",
  ownerName: "${ownerName}",
  adminCode: "${adminCode}",
  tables: ${JSON.stringify(tableDefs, null, 2).replace(/"/g, '"')},
};

/** 按角色取表配置 */
export function tableConfig(role: OfficeTableConfig["role"]): OfficeTableConfig | undefined {
  return OFFICE_CONFIG.tables.find((t) => t.role === role);
}

/** 取某表的字段映射（逻辑语义 -> 真实字段名） */
export function fieldsOf(role: OfficeTableConfig["role"]): OfficeFieldMap {
  return tableConfig(role)?.fields ?? {};
}

/** 取某表的真实表名（展示用）：客户表叫什么就显示什么 */
export function tableTitle(role: OfficeTableConfig["role"], fallback: string): string {
  return tableConfig(role)?.title || fallback;
}
`;
  // ── ④ 本地模式启动（方案 C：页面运行在用户 agent 环境）─────────
  // 不创建任何应用、不发布、不配置任何凭证——页面直接在本机运行，
  // 通过 lark-cli 以用户扫码授权的身份读写飞书表格。
  // 为避免污染 skill 自带的模板，生成结果输出到独立目录 office-live-output/。
  // 若脚本在 .codex/.agents 的 Skill 安装目录内运行，则自动改到用户工作输出目录。
  // 注意：目录名用纯 ASCII（不用中文），避免 Windows + Node cpSync 在全角路径下丢文件的 bug。
  step("本地启动准备", Date.now() - started);
  const localPort = await pickLocalPort();
  const outDir = defaultOutputRoot();
  try {
    // 1) 复制模板（排除大目录与脚本/文档）到输出目录
    // Windows 下 Node fs.cpSync 对含中文/全角字符的【源路径】会触发 stack overflow 崩溃（0xC0000409）。
    // 用户可能把 skill 装在中文目录（如 "office-live-豆包"），所以不能依赖 cpSync。
    // 改用逐文件递归复制（copyFileSync），彻底规避——skill 装在任意路径都不崩。
    const { readdirSync, statSync, copyFileSync, rmSync } = await import("node:fs");
    function copyDirTree(src, dst) {
      const st = statSync(src);
      if (st.isDirectory()) {
        mkdirSync(dst, { recursive: true });
        for (const name of readdirSync(src)) copyDirTree(join(src, name), join(dst, name));
      } else {
        mkdirSync(dirname(dst), { recursive: true });
        copyFileSync(src, dst);
      }
    }
    if (existsSync(outDir)) rmSync(outDir, { recursive: true });
    mkdirSync(outDir, { recursive: true });
    // 先建 lib 子目录，确保后续 writeFileSync 一定成功
    mkdirSync(join(outDir, "lib"), { recursive: true });
    for (const entry of [
      "app", "components", "lib", "public", "scripts", "types", "bin",
      "next.config.ts", "package.json", "package-lock.json", "tsconfig.json",
      "vercel.json", "server.ts", "server.prod.mjs", "postcss.config.mjs",
      "eslint.config.mjs", "next-env.d.ts", "components.json", ".npmrc",
    ]) {
      const src = join(pageRoot, entry);
      if (existsSync(src)) copyDirTree(src, join(outDir, entry));
    }
    // 2) 输出目录内的配置：模板的 office-config.ts 是占位符，覆盖为本次生成的真实配置
    writeFileSync(join(outDir, "lib", "office-config.ts"), config);
    console.log("配置已生成:", tableDefs.map((t) => `${t.role}=${t.id}`).join(" | "));
    // 3) 本地模式 basePath 置空（模板已是空，双保险）
    const nextConfigFile = join(outDir, "next.config.ts");
    const basePathFile = join(outDir, "lib", "base-path.ts");
    const nextConfigSrc = readFileSync(nextConfigFile, "utf8");
    const basePathSrc = readFileSync(basePathFile, "utf8");
    const nextConfigNext = nextConfigSrc.replace(/basePath:\s*"[^"]*"/, 'basePath: ""');
    const basePathNext = basePathSrc.replace(/export const BASE_PATH = "[^"]*"/, 'export const BASE_PATH = ""');
    if (nextConfigNext !== nextConfigSrc) writeFileSync(nextConfigFile, nextConfigNext, "utf8");
    if (basePathNext !== basePathSrc) writeFileSync(basePathFile, basePathNext, "utf8");
    writeFileSync(join(outDir, ".office-live-port"), `${localPort}\n`, "utf8");
    const larkBin = resolveLarkBin();
    writeFileSync(join(outDir, ".env.local"), `PORT=${localPort}\nOFFICE_LIVE_PORT=${localPort}\nLARK_CLI_BIN=${larkBin}\n`, "utf8");
    console.log(`页面已生成到独立目录: ${outDir}（不污染 skill 模板）`);
    if (localPort !== 3000) {
      console.log(`端口 3000 已被占用，本次自动使用端口 ${localPort}。`);
    }
  } catch (e) {
    throw new Error(`本地启动准备失败（${e.message}）`);
  }

  // ── ⑤ 验证：直接调 lark-cli 读表确认授权与数据可用 ─────────────
  step("数据验证", Date.now() - started);
  try {
    const snapRaw = run(larkCmd(`base +record-list --base-token ${base} --table-id ${taskTable} --limit 3 --as user --json`), { timeout: 30000 });
    const snap = JSON.parse(snapRaw);
    console.log(`数据验证: 主入口表 ${taskTableName} 字段 ${snap.data?.fields?.length || 0} 个, 样例 ${snap.data?.data?.length || 0} 条；全量配置表 ${tableDefs.length} 张`);
  } catch (e) {
    console.log("数据验证失败（授权可能未完成或表格不可读）:", e.message);
  }

  // ── ⑥ 输出本地启动指引 ─────────────────────────
  console.log(`\n✅ 配置已生成，总耗时 ${((Date.now() - started) / 1000).toFixed(0)}s`);
  console.log(`   表格: ${baseRealName || tables[0]?.name || "未知"} | 管理口令: ${adminCode}`);
  console.log(`\n   启动本地页面（必须用「用户级登录自启」方式：Windows 登录触发计划任务 + VBScript 隐藏窗口 / macOS launchd，避免被 agent 环境回收，详见 references/deployment.md「启动页面」）：`);
  console.log(`   Windows: 在输出目录注册登录触发计划任务 schtasks /Create /TN "OfficeLiveServer" /TR "wscript.exe \\"<输出目录>\\start-hidden.vbs\\"" /SC ONLOGON /RL LIMITED /F，再 schtasks /Run /TN "OfficeLiveServer" → 打开 http://localhost:${localPort}`);
  console.log(`   macOS: 用 launchd 加载（见 deployment.md「启动页面」） → 打开 http://localhost:${localPort}`);
  console.log(`   验证首页 200 与快照 source: feishu 后再交付地址。`);
  console.log(`\n   页面通过 lark-cli 读写您的飞书表格（当前授权用户: ${authorizedUser || "已登录用户"}）。`);
  console.log(`   提示：表格分享权限为「可编辑」时支持双向同步；未开启或仅可阅读时只能查看与互动（写回被拦下）。`);
  console.log(`   注：再次生成会覆盖上一份本地页面（同一输出目录），飞书表格数据不受影响。`);
} catch (e) {
  console.error(`\n❌ 失败（已耗时 ${((Date.now() - started) / 1000).toFixed(0)}s）: ${e.message}`);
  process.exit(1);
}
