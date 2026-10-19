#!/usr/bin/env bash
# 安装开机自启（Linux）：注册 systemd 用户服务，登录时后台静默启动，并立即启动。
# 对应 Windows 的 安装开机自启.cmd（HKCU Run 键 -> silent-start.vbs）。
set -euo pipefail
cd "$(dirname "$0")" || exit 1
ROOT="$(pwd)"

if ! command -v systemctl >/dev/null 2>&1 || ! systemctl --user is-system-running >/dev/null 2>&1; then
  echo "未检测到可用的 systemd 用户会话，无法安装服务。"
  echo "可改用前台运行：npm run dev"
  exit 1
fi

NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  echo "找不到 node，请先安装 Node.js 或把它加入 PATH。"
  exit 1
fi
NODE_DIR="$(dirname "$NODE")"

UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT="$UNIT_DIR/shadowing-reader.service"
TEMPLATE="$ROOT/server/shadowing-reader.service.template"

mkdir -p "$UNIT_DIR"
sed -e "s|__ROOT__|$ROOT|g" \
    -e "s|__NODE__|$NODE|g" \
    -e "s|__NODE_DIR__|$NODE_DIR|g" \
    "$TEMPLATE" > "$UNIT"

systemctl --user daemon-reload
systemctl --user enable --now shadowing-reader.service

# linger：让服务在「未登录」时也随开机启动。失败不致命，给出提示。
if command -v loginctl >/dev/null 2>&1; then
  if loginctl enable-linger "$USER" 2>/dev/null; then
    echo "已开启 linger：无需登录也会随开机启动。"
  else
    echo "提示：若希望开机（未登录）就启动，请运行： sudo loginctl enable-linger $USER"
  fi
fi

echo "开机自启已安装：$UNIT"
echo "运行 ./启动服务.sh 可查看状态。"
