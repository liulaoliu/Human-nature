#!/usr/bin/env bash
# 安装离线神经语音 Piper（Linux aarch64 / x86_64），并下载 4 个英语音色。
#
#   ./tools/install-piper.sh
#
# 默认装到 ~/.local/opt/piper（不需要 sudo）；可用环境变量覆盖：
#   PIPER_HOME=~/.local/opt/piper
#   PIPER_VOICES_DIR=$PIPER_HOME/voices
#   PIPER_RELEASE=2023.11.14-2
#
# 装完重启服务（./停止服务.sh && ./启动服务.sh 或 systemctl --user restart shadowing-reader.service），
# 顶栏音色下拉会出现「离线 · 本地语音」里的 Piper 音色。espeak-ng 仍保留为最后一道应急兜底。
set -euo pipefail

PIPER_RELEASE="${PIPER_RELEASE:-2023.11.14-2}"
PIPER_HOME="${PIPER_HOME:-$HOME/.local/opt/piper}"
VOICES_DIR="${PIPER_VOICES_DIR:-$PIPER_HOME/voices}"
TMP_DIR="${TMPDIR:-/tmp}"

case "$(uname -m)" in
  aarch64 | arm64) ARCH=aarch64 ;;
  x86_64 | amd64) ARCH=x86_64 ;;
  *)
    echo "不支持的架构：$(uname -m)（只提供 aarch64 / x86_64）" >&2
    exit 1
    ;;
esac

curl_dl() {
  # 老版本 curl 没有 --retry-all-errors；这里只用兼容参数。
  curl -fL --http1.1 --retry 5 --retry-delay 2 --connect-timeout 20 --max-time 900 "$@"
}

mkdir -p "$PIPER_HOME" "$VOICES_DIR"

if [ ! -x "$PIPER_HOME/piper" ]; then
  echo "==> 下载 Piper 二进制（linux_${ARCH}, ${PIPER_RELEASE}）"
  TARBALL="$TMP_DIR/piper_linux_${ARCH}.tar.gz"
  curl_dl -o "$TARBALL" \
    "https://github.com/rhasspy/piper/releases/download/${PIPER_RELEASE}/piper_linux_${ARCH}.tar.gz"
  echo "==> 解压到 $PIPER_HOME"
  tar -xzf "$TARBALL" -C "$PIPER_HOME" --strip-components=1
  chmod +x "$PIPER_HOME/piper"
else
  echo "==> 已存在 $PIPER_HOME/piper，跳过二进制下载"
fi

# 模型来自 https://huggingface.co/rhasspy/piper-voices （个人自用）。
MODELS=(
  "en/en_US/lessac/medium/en_US-lessac-medium"
  "en/en_US/ryan/high/en_US-ryan-high"
  "en/en_GB/cori/high/en_GB-cori-high"
  "en/en_GB/northern_english_male/medium/en_GB-northern_english_male-medium"
)
BASE_URL="https://huggingface.co/rhasspy/piper-voices/resolve/main"

for path in "${MODELS[@]}"; do
  name="$(basename "$path")"
  onnx="$VOICES_DIR/$name.onnx"
  json="$onnx.json"
  if [ -s "$onnx" ] && [ -s "$json" ]; then
    echo "==> 已有模型 $name，跳过"
    continue
  fi
  echo "==> 下载模型 $name"
  curl_dl -o "$onnx.part" "$BASE_URL/$path.onnx"
  mv "$onnx.part" "$onnx"
  curl_dl -o "$json.part" "$BASE_URL/$path.onnx.json"
  mv "$json.part" "$json"
done

echo "==> 验证 Piper"
"$PIPER_HOME/piper" --help >/dev/null

echo
echo "✅ Piper 安装完成"
echo "   二进制: $PIPER_HOME/piper"
echo "   模型:   $VOICES_DIR"
echo "   音色:   Lessac（美音女）/ Ryan（美音男）/ Cori（英音女）/ Northern（英音男）"
echo
echo "下一步：重启服务，然后刷新页面，在顶栏音色里选「离线 · 本地语音」下的 Piper 音色。"
echo "  systemctl --user restart shadowing-reader.service"
echo "或："
echo "  ./停止服务.sh && ./启动服务.sh"
