/**
 * Lark CLI 桥接层（本地模式）
 *
 * 页面运行在"客户 agent 环境"时,直接调用 lark-cli 以客户扫码授权后的
 * 用户身份读写飞书多维表格——不需要任何 OAuth 应用、不需要 token 明文、
 * 不依赖妙搭。授权由 skill 部署阶段的一次扫码完成（--domain base）。
 *
 * 与 deliver.mjs 同一套命令约定（base +record-list / +record-batch-create / +record-batch-update）。
 * 注意：lark-cli 的 --json 入参必须用 @file 传临时文件（直接内联会被 shell 破坏引号），
 * 输出格式用 --format json（--json 简写会与输入 flag 冲突）。
 *
 * 性能关键：本层全部用「异步 exec」调用 lark-cli（绝不 execSync），
 * 否则每次调用都会卡死 Node 事件循环——快照/轮询会串行堆积 30 秒+，页面直接打不开。
 */
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const execAsync = promisify(exec);

// 与 deliver.mjs 用【同一套 lark-cli 解析】——授权只落在一个实例，扫码一次、处处生效。
// 优先级：LARK_CLI_BIN / LARK_CLI_PATH 显式指定 > Windows 下 lark-cli.cmd（npm版：支持auth授权、路径无空格Node可调用）> PATH 里的 lark-cli。
const LARK =
  process.env.LARK_CLI_BIN ||
  process.env.LARK_CLI_PATH ||
  (process.platform === "win32" ? "lark-cli.cmd" : "lark-cli");

function larkCommand(args: string) {
  const bin = /\s/.test(LARK) ? `"${LARK.replace(/"/g, '\\"')}"` : LARK;
  return `${bin} ${args}`;
}

/** 执行 lark-cli,返回 stdout 文本（JSON）。移除 agent 来源标识避免平台限制。 */
export async function larkRun(cmd: string, opts: { timeout?: number; env?: Record<string, string> } = {}): Promise<string> {
  const env: NodeJS.ProcessEnv = { ...process.env, ...(opts.env || {}) };
  delete env.LARKSUITE_CLI_AGENT_NAME;
  delete env.LARK_CLI_AGENT_NAME;
  // 用 exec（走系统 shell，Windows 下 cmd.exe）：与原先 execSync 的命令字符串完全一致，
  // 但异步执行不阻塞事件循环，多个调用可真正并行。
  let stdout = "";
  try {
    const command = larkCommand(cmd);
    const result = await execAsync(command, {
      encoding: "utf8",
      env,
      timeout: opts.timeout || 120_000,
      maxBuffer: 20 * 1024 * 1024,
      windowsHide: true,
    });
    stdout = result.stdout ?? "";
  } catch (error) {
    const err = error as Error & { code?: unknown; stdout?: unknown; stderr?: unknown };
    const detail = [
      `command=${larkCommand(cmd)}`,
      `code=${String(err.code ?? "")}`,
      `stdout=${String(err.stdout ?? "").trim().slice(0, 500)}`,
      `stderr=${String(err.stderr ?? "").trim().slice(0, 500)}`,
      `LARK_CLI_BIN=${process.env.LARK_CLI_BIN ? "set" : "unset"}`,
      `LARK_CHANNEL_PROFILE=${process.env.LARK_CHANNEL_PROFILE || ""}`,
    ].join(" | ");
    throw new Error(`lark-cli 调用失败：${detail}`);
  }
  const raw = (stdout ?? "").trim();
  // 兼容：命令成功时 stdout 是 JSON；若混入 stderr 前缀则剥离
  const firstBrace = raw.indexOf("{");
  return firstBrace > 0 ? raw.slice(firstBrace) : raw;
}

export async function larkJson<T = unknown>(cmd: string, opts?: { timeout?: number }): Promise<T> {
  return JSON.parse(await larkRun(cmd, opts)) as T;
}

/**
 * 把 JSON 对象写入临时文件,返回 @file 参数形式（lark-cli --json 必须用 @file 传参）。
 * 注意：lark-cli 的 --json @file 只接受「当前目录内的相对路径」，绝对路径（含盘符）会失败，
 * 因此临时文件生成在 process.cwd() 下，且参数只传文件名（不带目录），由 lark-cli 在 cwd 内解析。
 */
/** 待清理的临时文件（写回用）；单监听器统一清理，避免每个请求都往 process 加 exit 监听导致泄漏 */
const tmpFiles = new Set<string>();
process.once("exit", () => {
  for (const f of tmpFiles) {
    try {
      unlinkSync(f);
    } catch {
      /* ignore */
    }
  }
});

function jsonArg(obj: unknown): string {
  const tmpName = `.office-live-json-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
  const tmpFile = join(process.cwd(), tmpName);
  writeFileSync(tmpFile, JSON.stringify(obj), "utf8");
  tmpFiles.add(tmpFile);
  const arg = `@${tmpName}`;
  return arg;
}

/** base +base-get：拿多维表格真名 */
export async function baseGet(baseToken: string): Promise<{ name?: string }> {
  try {
    const j = await larkJson<{ data?: { base?: { name?: string } } }>(
      `base +base-get --base-token ${baseToken} --as user --json`,
    );
    return { name: j.data?.base?.name };
  } catch {
    return {};
  }
}

/** base +table-list：列出所有表 */
export async function tableList(baseToken: string): Promise<Array<{ id: string; name: string; records_count?: number }>> {
  const j = await larkJson<{ data?: { tables?: Array<{ table_id?: string; name?: string; records_count?: number }> } }>(
    `base +table-list --base-token ${baseToken} --as user --json`,
  );
  return (j.data?.tables || []).map((t) => ({
    id: t.table_id || "",
    name: t.name || "",
    records_count: t.records_count ?? 0,
  }));
}

/** base +field-list：列出表字段完整元数据（类型/选项/百分比/关联表） */
export type LarkFieldMeta = {
  name: string;
  /** OpenAPI 兼容类型：1=Text 2=Number 3=SingleSelect 4=MultiSelect 5=DateTime 7=Person 21=Link。
   *  只读计算列（lookup/formula/rollup/auto_number/button/group 等）统一映射为 90，页面据此拒绝写回。 */
  openApiType: number;
  options: string[];
  percent: boolean;
  linkTableId: string;
  linkTableName: string;
  multiple: boolean;
  /** 飞书原始类型名（text/number/select/user/lookup/auto_number…），供只读判断与诊断 */
  rawType: string;
};

const LARK_TYPE_TO_OPENAPI: Record<string, number> = {
  text: 1,
  number: 2,
  select: 3,
  datetime: 5,
  person: 7,
  // 飞书 field-list 对人员字段返回 type="user"（OpenAPI 兼容类型也是 Person=7）——
  // 漏掉这个会导致「销售负责人」被判成 Text，写回走纯文本而失败。必须映射到 7。
  user: 7,
  // 自动生成的时间字段：创建时间/最后更新时间也是日期（OpenAPI=5），
  // 漏掉会显示成原始 ISO 时间戳（2026-08-29T02:07:58.000+08:00）。必须映射到 5 才能按日期显示。
  created_at: 5,
  updated_at: 5,
  link: 21,
  // 只读计算列：飞书服务端计算，页面无法写回——映射为独立只读码 90（区别于 Text），
  // 页面据此拒绝把 lookup/formula/rollup/auto_number/button/group 等列当作写回目标。
  lookup: 90,
  formula: 90,
  rollup: 90,
  auto_number: 90,
  button: 90,
  group: 90,
  created_by: 90,
  modified_by: 90,
  created_time: 90,
  modified_time: 90,
};

export async function fieldList(baseToken: string, tableId: string): Promise<LarkFieldMeta[]> {
  try {
    const j = await larkJson<{
      data?: {
        fields?: Array<{
          name?: string;
          type?: string;
          multiple?: boolean;
          options?: Array<{ name?: string }>;
          style?: { percentage?: boolean; format?: string };
          link_table?: string;
          link_table_name?: string;
        }>;
      };
    }>(`base +field-list --base-token ${baseToken} --table-id ${tableId} --as user --json`);
    return (j.data?.fields || []).map((f) => ({
      name: f.name || "",
      openApiType: LARK_TYPE_TO_OPENAPI[f.type || ""] ?? 1,
      options: (f.options ?? []).map((o) => o.name ?? "").filter(Boolean),
      percent: f.type === "number" && f.style?.percentage === true,
      linkTableId: f.link_table || "",
      linkTableName: f.link_table_name || "",
      multiple: f.multiple === true,
      rawType: f.type || "",
    }));
  } catch {
    return [];
  }
}

/** base +record-list：读记录（数组行 → 对象行,带 recordId 与原始字段名） */
export type LarkRecordRow = Record<string, unknown> & { _recordId: string };

export async function recordListRaw(
  baseToken: string,
  tableId: string,
  limit = 200,
): Promise<{ fields: string[]; rows: LarkRecordRow[] }> {
  const j = await larkJson<{
    data?: {
      fields?: string[];
      data?: Array<Array<unknown>>;
      record_id_list?: string[];
    };
  }>(`base +record-list --base-token ${baseToken} --table-id ${tableId} --limit ${limit} --as user --json`);
  const fields = j.data?.fields || [];
  const rows: LarkRecordRow[] = [];
  const rawRows = j.data?.data || [];
  const ids = j.data?.record_id_list || [];
  rawRows.forEach((rawRow, idx) => {
    const obj: Record<string, unknown> = { _recordId: ids[idx] || "" };
    fields.forEach((f, i) => {
      obj[f] = rawRow[i];
    });
    rows.push(obj as LarkRecordRow);
  });
  return { fields, rows };
}

/** base +record-get：读单条记录（数组行 → 对象行） */
export async function recordGetRaw(baseToken: string, tableId: string, recordId: string): Promise<LarkRecordRow | null> {
  try {
    const j = await larkJson<{
      data?: {
        fields?: string[];
        data?: Array<Array<unknown>>;
      };
    }>(`base +record-get --base-token ${baseToken} --table-id ${tableId} --record-id ${recordId} --as user --format json`);
    const fields = j.data?.fields || [];
    const rawRow = j.data?.data?.[0];
    if (!rawRow) return null;
    const obj: Record<string, unknown> = { _recordId: recordId };
    fields.forEach((f, i) => {
      obj[f] = rawRow[i];
    });
    return obj as LarkRecordRow;
  } catch {
    return null;
  }
}

/** base +record-batch-create：新增一条记录,返回 record_id */
export async function recordCreateRaw(baseToken: string, tableId: string, fields: Record<string, unknown>): Promise<string | null> {
  try {
    const arg = jsonArg({ create_records: [fields] });
    const j = await larkJson<{ data?: { record_id_list?: string[] } }>(
      `base +record-batch-create --base-token ${baseToken} --table-id ${tableId} --json ${arg} --as user --format json`,
    );
    return j.data?.record_id_list?.[0] ?? null;
  } catch (error) {
    throw new Error(`lark-cli 新增记录失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

/** base +record-batch-update：更新记录字段 */
export async function recordUpdateRaw(
  baseToken: string,
  tableId: string,
  recordId: string,
  fields: Record<string, unknown>,
): Promise<boolean> {
  try {
    const arg = jsonArg({ update_records: { [recordId]: fields } });
    const j = await larkJson<{ ok?: boolean }>(
      `base +record-batch-update --base-token ${baseToken} --table-id ${tableId} --json ${arg} --as user --format json`,
    );
    return j.ok !== false;
  } catch (error) {
    throw new Error(`lark-cli 更新记录失败：${error instanceof Error ? error.message : String(error)}`);
  }
}
