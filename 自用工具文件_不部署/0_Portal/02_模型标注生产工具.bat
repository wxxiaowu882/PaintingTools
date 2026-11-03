@echo off
chcp 65001 >nul
setlocal
REM 模型标注生产工具
REM 内嵌 GLB 管理器需要 18080（选目录记住路径 / 打开所在文件夹）
REM 请双击本 bat，不要只用 Live Server

set "PORT=18080"
set "URL=http://127.0.0.1:%PORT%/自用工具文件_不部署/模型标注生产工具.html"
set "SERVE_DIR=%~dp0..\..\.cursor\browser-automation"

netstat -ano | findstr ":%PORT% " | findstr "LISTENING" >nul 2>&1
if errorlevel 1 (
  echo [模型标注生产工具] 18080 未在听，正在启动静态服务…
  if not exist "%SERVE_DIR%\package.json" (
    echo [错误] 找不到: %SERVE_DIR%\package.json
    pause
    exit /b 1
  )
  where node >nul 2>&1
  if errorlevel 1 (
    echo [错误] 未找到 node，请先安装 Node.js
    pause
    exit /b 1
  )
  pushd "%SERVE_DIR%"
  start "PaintingTools-18080" /min cmd /c "npm run serve:repo"
  popd
  timeout /t 2 /nobreak >nul
)

echo 打开: %URL%
echo 提示: 导入素模会打开内嵌 GLB 管理器，需本机 18080 才能记住文件夹路径。
start "" "%URL%"
endlocal
