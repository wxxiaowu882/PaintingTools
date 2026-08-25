@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo.
echo ========================================
echo   Sketchfab 批量下载控制台
echo ========================================
echo.
echo 工作目录: %CD%
echo 启动后请用浏览器打开:
echo   http://127.0.0.1:18999/
echo.
echo 关闭本窗口 = 停止下载服务
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 node，请先安装 Node.js 并确保已加入 PATH。
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 npm，请检查 Node.js 安装是否完整。
  pause
  exit /b 1
)

REM 稍等服务起来后再打开浏览器（若 18999 已在跑，页面也能直接用）
start "open-sketchfab-ui" /min cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:18999/"

call npm run sketchfab:ui
echo.
echo 服务已退出。
pause
