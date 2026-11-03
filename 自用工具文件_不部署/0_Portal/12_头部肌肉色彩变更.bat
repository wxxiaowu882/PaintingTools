@echo off
chcp 65001 >nul 2>&1
setlocal EnableExtensions

set "PORT=8765"
set "URL=http://127.0.0.1:%PORT%/"
set "TITLE=PaintingTools-8765"
set "REVIEW_DIR=%~dp0..\篡改猴\亚洲头部肌肉模型\work_v4\compare_review"

pushd "%REVIEW_DIR%" 2>nul
if errorlevel 1 (
  echo [错误] 无法进入 compare_review 目录：
  echo   %REVIEW_DIR%
  pause
  exit /b 1
)

if not exist "index.html" (
  echo [错误] 找不到 index.html：
  echo   %CD%\index.html
  popd
  pause
  exit /b 1
)

if not exist "serve_nocache.py" (
  echo [错误] 找不到 serve_nocache.py
  popd
  pause
  exit /b 1
)

if not exist "_portal_server.bat" (
  echo [错误] 找不到 _portal_server.bat
  popd
  pause
  exit /b 1
)

call :verify_server
if not errorlevel 1 goto :open_browser

call :kill_port_if_listening

echo [头部肌肉色彩变更] 正在启动端口 %PORT% 上的服务...

where python >nul 2>&1
if errorlevel 1 (
  where py >nul 2>&1
  if errorlevel 1 (
    echo [错误] 未找到 python / py，请先安装 Python 并加入 PATH
    popd
    pause
    exit /b 1
  )
)

start "%TITLE%" /min cmd /k call "%CD%\_portal_server.bat"

set /a WAIT=0
:wait_loop
timeout /t 1 /nobreak >nul
call :verify_server
if not errorlevel 1 goto :open_browser
set /a WAIT+=1
if %WAIT% lss 20 goto :wait_loop

echo.
echo [错误] 等待 %WAIT% 秒后服务仍未就绪
echo 请查看任务栏窗口 %TITLE% 里的 Python 报错。
popd
pause
exit /b 1

:open_browser
echo [OK] %URL%
echo 正在打开浏览器...
start "" "%URL%"
if errorlevel 1 (
  echo [提示] 未能自动打开浏览器，请手动访问：
  echo   %URL%
  pause
)
popd
endlocal
exit /b 0

:kill_port_if_listening
netstat -ano | findstr /R /C:":%PORT% .*LISTENING" >nul 2>&1
if errorlevel 1 exit /b 0
echo.
echo [提示] 端口 %PORT% 已被占用，正在自动结束占用进程并重启服务...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do (
  if not "%%P"=="0" (
    echo   结束 PID %%P
    taskkill /F /PID %%P >nul 2>&1
  )
)
timeout /t 1 /nobreak >nul
exit /b 0

:verify_server
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri '%URL%api/health' -TimeoutSec 3; if ($r.StatusCode -eq 200 -and $r.Content -match 'compare_review') { exit 0 } else { exit 1 } } catch { exit 1 }"
exit /b %errorlevel%
