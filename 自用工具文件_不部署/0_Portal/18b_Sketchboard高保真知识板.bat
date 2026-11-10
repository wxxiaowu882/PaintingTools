@echo off
chcp 936 >nul
setlocal EnableExtensions
REM Sketchboard / Mubu knowledge board viewer (ASCII-only)
REM Needs static server on 18080; starts it if missing

set "PORT=18080"
set "TITLE=PaintingTools-18080"
set "SERVE_DIR=%~dp0..\..\.cursor\browser-automation"

echo.
echo ========================================
echo   Sketchboard knowledge board
echo   Port: %PORT%
echo ========================================
echo.

netstat -ano | findstr ":%PORT% " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 goto :open_browser

echo [board] %PORT% not listening, starting static server...
if not exist "%SERVE_DIR%\package.json" (
  echo [ERROR] missing: %SERVE_DIR%\package.json
  pause
  exit /b 1
)
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] node not found. Install Node.js and add to PATH.
  pause
  exit /b 1
)
pushd "%SERVE_DIR%"
start "%TITLE%" /min cmd /c "npm run serve:repo"
popd

set /a WAIT=0
:wait_loop
timeout /t 1 /nobreak >nul
netstat -ano | findstr ":%PORT% " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 goto :open_browser
set /a WAIT+=1
if %WAIT% lss 25 goto :wait_loop

echo.
echo [ERROR] port %PORT% still not ready after %WAIT%s.
echo Check taskbar window "%TITLE%" for errors.
pause
exit /b 1

:open_browser
echo [OK] server ready
echo Opening browser...
REM Open via PowerShell so percent-encoded Chinese path is not eaten by cmd %%
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process 'http://127.0.0.1:18080/docs/%%E7%%BE%%8E%%E6%%9C%%AF%%E7%%9F%%A5%%E8%%AF%%86%%E5%%BA%%93/Sketchboard%%E7%%AC%%94%%E8%%AE%%B0/viewer'"
if errorlevel 1 (
  echo [HINT] Open manually in browser:
  echo   http://127.0.0.1:18080/docs/.../viewer
  pause
)
endlocal
exit /b 0
