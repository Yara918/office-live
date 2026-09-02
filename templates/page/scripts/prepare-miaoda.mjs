/**
 * 妙搭 full_stack 产物组织（对齐 fullstack-cli 模板约定）：
 *   - dist/ 根：run.sh（模板从 dist/ 执行 `node server/main.js`）
 *   - dist/server/：Next standalone 产物（server.js + .next + node_modules）
 *   - dist/server/main.js：入口别名（模板 run.sh 固定找 server/main.js）
 *   - dist/client/：静态资源（.next/static + public）
 */
import { existsSync, mkdirSync, rmSync, cpSync, readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const standalone = resolve(root, ".next", "standalone");
const dist = resolve(root, "dist");

if (!existsSync(standalone)) {
  console.error("ERROR: .next/standalone/ not found. Run `next build` first.");
  process.exit(1);
}

console.log("Preparing Miaoda dist (dist/server + dist/client)...\n");

// --- 清空 dist ---
if (existsSync(dist)) rmSync(dist, { recursive: true });

// --- dist/server: standalone 产物 + 静态资源补充 ---
const server = resolve(dist, "server");
mkdirSync(server, { recursive: true });
cpSync(standalone, server, { recursive: true });

// standalone 需要 .next/static 和 public 才能完整跑
if (existsSync(resolve(root, ".next", "static"))) {
  mkdirSync(resolve(server, ".next"), { recursive: true });
  cpSync(resolve(root, ".next", "static"), resolve(server, ".next", "static"), { recursive: true });
}
if (existsSync(resolve(root, "public"))) {
  cpSync(resolve(root, "public"), resolve(server, "public"), { recursive: true });
}

const copiedPackages = new Set();
function packageTarget(packageName) {
  const parts = packageName.startsWith("@") ? packageName.split("/") : [packageName];
  return resolve(server, "node_modules", ...parts);
}

function copyRuntimePackage(packageName) {
  if (copiedPackages.has(packageName)) return;
  copiedPackages.add(packageName);
  const packageJsonPath = resolve(root, "node_modules", ...packageName.split("/"), "package.json");
  if (!existsSync(packageJsonPath)) {
    return;
  }
  const packageDir = dirname(packageJsonPath);
  const target = packageTarget(packageName);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(packageDir, target, { recursive: true });

  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const deps = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.peerDependencies || {}),
    ...(packageJson.optionalDependencies || {}),
  };
  for (const depName of Object.keys(deps)) {
    copyRuntimePackage(depName);
  }
}

const rootPackage = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
for (const depName of Object.keys(rootPackage.dependencies || {})) {
  copyRuntimePackage(depName);
}
for (const depName of [
  "@lark-apaas/fullstack-nestjs-core",
  "@nestjs/common",
  "@nestjs/config",
  "@nestjs/core",
  "drizzle-orm",
  "reflect-metadata",
  // keyv 家族：cache-service 嵌套 @keyv/redis + keyv，递归复制从 root 找不到嵌套包
  // 会提前 return，导致其依赖(@redis/client/cluster-key-slot/hookified)永不复制，显式打包
  "@keyv/serialize",
  "@keyv/redis",
  "@redis/client",
  "cluster-key-slot",
  "hookified",
  "keyv",
  "cache-manager",
  "@nestjs/cache-manager",
  // @opentelemetry：sdk-trace-node 嵌套了 sdk-trace-base@2.10.0，其依赖
  // @opentelemetry/sdk-trace 被提升到 root 顶层，递归分析(只读顶层包 deps)看不到，
  // 线上从嵌套 sdk-trace-base 向上解析时找不到，显式打包
  "@opentelemetry/sdk-trace",
  "@opentelemetry/sdk-trace-base",
  "@opentelemetry/sdk-node",
]) {
  copyRuntimePackage(depName);
}
console.log(`  done  runtime packages → dist/server/node_modules (${copiedPackages.size} packages)`);
console.log("  done  .next/standalone(+static+public) → dist/server");

// --- 入口别名：模板 run.sh 固定 `node server/main.js`（cwd=dist/） ---
// main.js 需切到自身目录（dist/server）再加载 server.js，保证 Next standalone 相对路径正确
const entry = resolve(server, "server.js");
if (existsSync(entry)) {
  const mainJs = resolve(server, "main.js");
  const content = `process.env.PORT = process.env.PORT || "8000";\nprocess.chdir(__dirname);\nrequire("./server.js");\n`;
  const { writeFileSync } = await import("node:fs");
  writeFileSync(mainJs, content, "utf8");
  console.log("  done  main.js → chdir+require server.js (run.sh 入口)");
} else {
  console.warn("  warn  server.js not found in standalone, skip main.js alias");
}

// --- dist/client: 静态资源 ---
const client = resolve(dist, "client");
mkdirSync(client, { recursive: true });
if (existsSync(resolve(root, ".next", "static"))) {
  cpSync(resolve(root, ".next", "static"), resolve(client, "_next", "static"), { recursive: true });
}
if (existsSync(resolve(root, "public"))) {
  cpSync(resolve(root, "public"), client, { recursive: true });
}
console.log("  done  static+public → dist/client");

// --- run.sh 放 dist/ 根（模板约定从 dist/ 启动） ---
const runSh = resolve(root, "scripts", "run.sh");
if (existsSync(runSh)) {
  cpSync(runSh, resolve(dist, "run.sh"));
  console.log("  done  run.sh → dist/run.sh");
}

console.log("\n  Miaoda dist ready.\n");
