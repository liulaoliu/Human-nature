#!/usr/bin/env bash
# 后台启动本地服务（独立进程，关终端不影响运行）。已运行则只显示状态并打开浏览器。
# 对应 Windows 的 启动服务.cmd。
#
# 已安装 systemd 用户服务时走 systemctl；否则退回仓库自带的 Node 分离进程
# （server/silent-start.ts，和 Windows 用的是同一套 watchdog）。
set -uo pipefail
cd "$(dirname "$0")" || exit 1

UNIT="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/shadowing-reader.service"
# 复用 server/status.ts 的端口解析逻辑（config.json / PORT 环境变量 / 默认 5173）
PORT="$(node --input-type=module -e "import { getPort } from './server/status.ts'; process.stdout.write(String(getPort()))")"

# 单元文件可能是旧版本留下的（例如后端 .js → .ts 迁移后没重装）：
# ExecStart 指向不存在的文件时 systemd 只会无休止地「启动 → 退出 → 重启」，先按模板重装。
if [ -f "$UNIT" ]; then
  EXEC_TARGET="$(sed -n 's/^ExecStart=//p' "$UNIT" | head -n 1 | awk '{print $2}')"
  if [ -n "${EXEC_TARGET:-}" ] && [ ! -f "$EXEC_TARGET" ]; then
    echo "服务单元指向的文件不存在：$EXEC_TARGET"
    echo "按当前模板重装 systemd 用户服务…"
    if ! ./安装开机自启.sh; then
      echo "重装失败：请手动运行 ./安装开机自启.sh"
      exit 1
    fi
  fi
fi

if command -v systemctl >/dev/null 2>&1 && [ -f "$UNIT" ]; then
  systemctl --user start shadowing-reader.service
else
  node server/silent-start.ts
fi

for _ in $(seq 1 15); do
  if node server/status.ts -q >/dev/null 2>&1; then
    node server/status.ts
    if command -v xdg-open >/dev/null 2>&1; then
      xdg-open "http://localhost:${PORT}/" >/dev/null 2>&1 &
    else
      echo "请在浏览器打开 http://localhost:${PORT}/"
    fi
    exit 0
  fi
  sleep 1
done

echo
echo "启动失败：端口 ${PORT} 无响应。"
echo "  - 若你在开发，占着 ${PORT} 的可能是另一个 dev 服务器，先关掉它，或运行 ./停止服务.sh。"
echo "  - static 模式需要先构建（./构建.sh）。"
exit 1
