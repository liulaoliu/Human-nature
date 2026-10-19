#!/usr/bin/env bash
# 停止后台服务：先停 systemd 用户服务，再按 PID 兜底清理。
# 对应 Windows 的 停止服务.cmd。
set -uo pipefail
cd "$(dirname "$0")" || exit 1

UNIT="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/shadowing-reader.service"

if command -v systemctl >/dev/null 2>&1 && [ -f "$UNIT" ]; then
  systemctl --user stop shadowing-reader.service 2>/dev/null || true
fi
# systemctl 没接管的进程（例如手动 npm run dev）再按 PID 兜底
if node server/status.js -q >/dev/null 2>&1; then
  node server/stop.js
fi
node server/status.js
