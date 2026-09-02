#!/usr/bin/env bash
# Office Live 小剧场 - 妙搭 full_stack 启动脚本
# 从 dist/ 根目录执行（构建产物目录），启动 Next.js standalone server
cd "$(dirname "$0")"
NODE_ENV=production PORT="${PORT:-3000}" node server.js
