#!/usr/bin/env bash
# Office Live 小剧场 - 妙搭 full_stack 构建脚本
# 产出：dist/ 目录（含 .next standalone 产物 + node_modules + run.sh）
set -euo pipefail

ROOT_DIR="$(pwd)"
DIST_DIR="$ROOT_DIR/dist"

echo "🗑️  [1/4] 清理 dist 目录"
rm -rf "$DIST_DIR"

echo "📦  [2/4] 安装依赖"
if command -v pnpm >/dev/null 2>&1; then
  pnpm install --no-frozen-lockfile
else
  npm install
fi

echo "🔨  [3/4] 构建 Next.js standalone"
npm run build

echo "📦  [4/4] 组织产物到 dist/"
# Next standalone 产物在 .next/standalone，复制到 dist/
mkdir -p "$DIST_DIR"
cp -r .next/standalone/. "$DIST_DIR/"
cp -r .next/static "$DIST_DIR/.next/static"
cp -r public "$DIST_DIR/public"
# 复制 run.sh 与精简 package.json
cp "$ROOT_DIR/scripts/run.sh" "$DIST_DIR/"
cp "$ROOT_DIR/package.json" "$DIST_DIR/"

echo "构建完成"
du -sh "$DIST_DIR"
