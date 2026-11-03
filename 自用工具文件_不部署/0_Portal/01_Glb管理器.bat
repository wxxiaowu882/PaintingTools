@echo off
chcp 65001 >nul
setlocal
REM GLB 标准化加工中心
REM 依赖仓库静态服务 18080（含选目录/打开所在文件夹 API）；未启动则自动拉起
REM 不要用 Live Server 打开本工具的「打开所在文件夹」能力——请双击本 bat

set "PORT=18080"
set "URL=http://127.0.0.1:%PORT%/自用工具文件_不部署/GBL管理器/Glb管理器.html"
set "SERVE_DIR=%~dp0..\..\.cursor\browser-automation"

netstat -ano | findstr ":%PORT% " | findstr "LISTENING" >nul 2>&1
if errorlevel 1 (
  echo [GLB管理器] 18080 未在听，正在启动静态服务…
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
echo 提示: 请用本窗口拉起的 18080 打开；「新文件夹」会记住完整路径，「打开所在文件夹」才可用。
start "" "%URL%"
endlocal
