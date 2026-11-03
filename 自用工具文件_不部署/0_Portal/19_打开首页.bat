@echo off
chcp 936 >nul
setlocal EnableExtensions
REM Consumer home page: repo root index via port 18080
REM Independent of VSCode LiveServer / port 8765

set "PORT=18080"
set "URL=http://127.0.0.1:%PORT%/index"
set "TITLE=PaintingTools-18080"
set "SERVE_DIR=%~dp0..\..\.cursor\browser-automation"

echo.
echo ========================================
echo   Open consumer home page
echo   URL: %URL%
echo   Expect port %PORT%, not 8765
echo.
echo NOTE: This is STATIC only (no membership API).
echo For member redeem / paid scenes, use staging or production:
echo   Portal 20b + 21c (test) or 20 + 21b (prod)
echo ========================================
echo.

netstat -ano | findstr ":%PORT% " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 goto :open_browser

echo [home] %PORT% not listening, starting static server...
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
echo Manual URL: %URL%
pause
exit /b 1

:open_browser
echo [OK] server ready
echo Opening: %URL%
start "" "%URL%"
if errorlevel 1 (
  echo [HINT] browser not opened. Open manually:
  echo   %URL%
  pause
)
endlocal
exit /b 0
