#!/usr/bin/env bash
# 取消开机自启：停用并删除 systemd 用户服务。
# 对应 Windows 的 卸载开机自启.cmd。
set -uo pipefail
cd "$(dirname "$0")" || exit 1

UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT="$UNIT_DIR/shadowing-reader.service"

if command -v systemctl >/dev/null 2>&1; then
  systemctl --user disable --now shadowing-reader.service 2>/dev/null || true
fi
rm -f "$UNIT"
if command -v systemctl >/dev/null 2>&1; then
  systemctl --user daemon-reload 2>/dev/null || true
fi

echo "开机自启已移除（$UNIT 已删除）。"
echo "提示：若不再需要免登录常驻，可运行： loginctl disable-linger $USER"
