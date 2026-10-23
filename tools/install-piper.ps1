# 安装离线神经语音 Piper（Windows x64），并下载 4 个英语音色。
#
#   powershell -ExecutionPolicy Bypass -File tools\install-piper.ps1
#
# 默认装到 <仓库>\.piper（不进 git；服务端会自动在这里找，不用配环境变量）：
#   <仓库>\.piper\piper\piper.exe
#   <仓库>\.piper\voices\*.onnx + *.onnx.json
# 可用参数覆盖：
#   -Proxy http://127.0.0.1:7897     # 本地代理（GitHub/HF 直连慢时用）
#   -Release 2023.11.14-2
#   -Destination D:\piper            # 装到别处
#
# 装完刷新页面，顶栏音色下拉会出现「离线 · 本地语音」下的 Piper 音色。
# 验证：GET /api/tts/engines 的 local.reason 应该是 ok。

param(
  [string]$Proxy = "",
  [string]$Release = "2023.11.14-2",
  [string]$Destination = ""
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$piperHome = if ($Destination) { $Destination } else { Join-Path $repoRoot ".piper" }
$voicesDir = Join-Path $piperHome "voices"
$exe = Join-Path $piperHome "piper\piper.exe"

function Invoke-Download([string]$Url, [string]$OutFile) {
  # 必须写 curl.exe：Windows PowerShell 5.1 里 curl 是 Invoke-WebRequest 的别名
  $args = @("-fL", "--http1.1", "--retry", "5", "--retry-delay", "2",
            "--connect-timeout", "20", "--max-time", "900", "-o", $OutFile, $Url)
  if ($Proxy) { $args = @("--proxy", $Proxy) + $args }
  & curl.exe @args
  if ($LASTEXITCODE -ne 0) { throw "下载失败（exit $LASTEXITCODE）：$Url" }
}

New-Item -ItemType Directory -Force -Path $piperHome, $voicesDir | Out-Null

if (Test-Path $exe) {
  Write-Host "==> 已存在 $exe，跳过二进制下载"
} else {
  $zip = Join-Path $env:TEMP "piper_windows_amd64.zip"
  Write-Host "==> 下载 Piper 二进制（windows_amd64, $Release）"
  Invoke-Download "https://github.com/rhasspy/piper/releases/download/$Release/piper_windows_amd64.zip" $zip
  Write-Host "==> 解压到 $piperHome"
  Expand-Archive -Path $zip -DestinationPath $piperHome -Force
  Remove-Item $zip -Force
}

# 模型来自 https://huggingface.co/rhasspy/piper-voices （个人自用）
$models = @(
  "en/en_US/lessac/medium/en_US-lessac-medium",
  "en/en_US/ryan/high/en_US-ryan-high",
  "en/en_GB/cori/high/en_GB-cori-high",
  "en/en_GB/northern_english_male/medium/en_GB-northern_english_male-medium"
)
$baseUrl = "https://huggingface.co/rhasspy/piper-voices/resolve/main"

foreach ($path in $models) {
  $name = Split-Path -Leaf $path
  $onnx = Join-Path $voicesDir "$name.onnx"
  $json = "$onnx.json"
  $haveOnnx = (Test-Path $onnx) -and ((Get-Item $onnx).Length -gt 0)
  $haveJson = (Test-Path $json) -and ((Get-Item $json).Length -gt 0)
  if ($haveOnnx -and $haveJson) {
    Write-Host "==> 已有模型 $name，跳过"
    continue
  }
  Write-Host "==> 下载模型 $name"
  Invoke-Download "$baseUrl/$path.onnx" "$onnx.part"
  Move-Item -Force "$onnx.part" $onnx
  Invoke-Download "$baseUrl/$path.onnx.json" "$json.part"
  Move-Item -Force "$json.part" $json
}

Write-Host "==> 验证 Piper（真合成一小段，不只看 --help）"
$probe = Join-Path $env:TEMP "piper-probe.wav"
if (Test-Path $probe) { Remove-Item $probe -Force }
"Piper test." | & $exe --model (Join-Path $voicesDir "en_US-lessac-medium.onnx") --output_file $probe --quiet 2>&1 | Out-Null
if (-not (Test-Path $probe) -or (Get-Item $probe).Length -le 44) {
  throw "piper.exe 跑不出音频（模型缺失或 espeak-ng-data 不在同级目录）：$exe"
}
Remove-Item $probe -Force

Write-Host ""
Write-Host "Piper 安装完成"
Write-Host "  二进制: $exe"
Write-Host "  模型:   $voicesDir"
Write-Host "  音色:   Lessac(美音女) / Ryan(美音男) / Cori(英音女) / Northern(英音男)"
Write-Host ""
Write-Host "下一步：刷新页面，顶栏音色里选「离线 · 本地语音」下的 Piper 音色。"
Write-Host "        验证接口：GET /api/tts/engines 的 local.reason 应为 ok。"
