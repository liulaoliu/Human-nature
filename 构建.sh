#!/usr/bin/env bash
# 构建（tsc + vite）。static 模式下改过源码后运行。
# 对应 Windows 的 构建.cmd。
set -uo pipefail
cd "$(dirname "$0")" || exit 1

if npm run build; then
  echo
  echo "构建成功，dist/ 已就绪。"
else
  echo
  echo "构建失败。"
  exit 1
fi
