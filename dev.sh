#!/usr/bin/env bash
# 前台运行开发服务器（Vite HMR）。先 ./停止服务.sh 让出端口。
# 对应 Windows 的 dev.cmd。
set -uo pipefail
cd "$(dirname "$0")" || exit 1
exec npm run dev
