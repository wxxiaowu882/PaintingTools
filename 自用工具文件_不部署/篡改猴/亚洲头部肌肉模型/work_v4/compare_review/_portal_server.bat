@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"

where python >nul 2>&1
if not errorlevel 1 (
  python -u serve_nocache.py --no-browser
  if not errorlevel 1 exit /b 0
)

where py >nul 2>&1
if not errorlevel 1 (
  py -3 -u serve_nocache.py --no-browser
  if not errorlevel 1 exit /b 0
)

echo [错误] 未找到可用的 python / py，或服务启动失败。
pause
exit /b 1
