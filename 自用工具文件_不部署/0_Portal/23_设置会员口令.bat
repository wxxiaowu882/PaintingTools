@echo off
setlocal EnableExtensions
REM Set membership secrets on Cloudflare Worker soft-voice-f822
REM Prefer wrangler secret put (Worker). Do NOT use dashboard Variables.
REM Order: run Portal 20 deploy bat at least once, then this bat.
REM ASCII-only bat (UTF-8 Chinese breaks cmd.exe double-click)

set "PROJECT=soft-voice-f822"
set "REPO=%~dp0..\.."

echo.
echo ========================================
echo   Set membership secrets (Worker)
echo   Project: %PROJECT%
echo ========================================
echo.
echo If dashboard says Variables cannot be added to static-assets Worker:
echo   use THIS script (not the web UI).
echo.
echo Suggested order: Portal 20 deploy first, then this script.
echo.
echo Will set:
echo   1) MEMBERSHIP_ADMIN_PASSWORD  (ops login)
echo   2) MEMBERSHIP_SECRET          (code/session signing)
echo.
pause

where npx >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npx / Node.js not found
  pause
  exit /b 1
)

cd /d "%REPO%"
if errorlevel 1 (
  echo [ERROR] cannot cd to repo root
  pause
  exit /b 1
)

echo.
echo ----- 1/2 MEMBERSHIP_ADMIN_PASSWORD -----
echo Enter ops login password (min 6 chars, visible while typing):
set /p ADMIN_PWD=
if "%ADMIN_PWD%"=="" (
  echo [CANCEL] empty
  pause
  exit /b 1
)

echo Uploading MEMBERSHIP_ADMIN_PASSWORD...
echo %ADMIN_PWD%| npx wrangler secret put MEMBERSHIP_ADMIN_PASSWORD --name %PROJECT%
if errorlevel 1 (
  echo [FAIL] wrangler secret put failed. Check: npx wrangler login
  echo And deploy once with Portal 20 so the Worker has a script.
  pause
  exit /b 1
)

echo.
echo ----- 2/2 MEMBERSHIP_SECRET -----
echo Enter MEMBERSHIP_SECRET (16+ random chars recommended, visible while typing):
set /p MEM_SECRET=
if "%MEM_SECRET%"=="" (
  echo [CANCEL] empty
  pause
  exit /b 1
)

echo Uploading MEMBERSHIP_SECRET...
echo %MEM_SECRET%| npx wrangler secret put MEMBERSHIP_SECRET --name %PROJECT%
if errorlevel 1 (
  echo [FAIL] wrangler secret put failed. Check: npx wrangler login
  pause
  exit /b 1
)

echo.
echo ========================================
echo   Done
echo ========================================
echo Open online ops with Portal 21b and try login.
echo (Worker secrets apply without another deploy.)
echo.
pause
endlocal
exit /b 0
