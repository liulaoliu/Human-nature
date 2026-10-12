@echo off
rem 把 new\ 里最新的 AI 工作包交给本机 opencode agent 跑完，产出 .results.json。
rem 非交互运行，agent 不会停下来问你问题。跑完回应用点「导入 AI 结果」即可。
setlocal
title AI 工作包批处理
cd /d "%~dp0"
call npm run ai:agent
if errorlevel 1 (
  echo.
  echo 跑批失败：确认已安装 opencode 且 opencode 里配好了可用的模型/供应商。
)
echo.
pause
