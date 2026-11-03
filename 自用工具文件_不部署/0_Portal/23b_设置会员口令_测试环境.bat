@echo off
setlocal EnableExtensions
REM Set membership secrets on STAGING Worker only
REM ASCII-only
REM Order: Portal 20b deploy once, then this bat

set "PROJECT=soft-voice-f822-staging"
set "REPO=%~dp0..\.."

echo.
echo ========================================
echo   Set membership secrets (STAGING)
echo   Project: %PROJECT%
echo   NOT production
echo ========================================
echo.
echo Will set on staging Worker:
echo   1) MEMBERSHIP_ADMIN_PASSWORD
echo   2) MEMBERSHIP_SECRET
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
echo Enter staging ops password (min 6 chars):
set /p ADMIN_PWD=
if "%ADMIN_PWD%"=="" (
  echo [CANCEL] empty
  pause
  exit /b 1
)

echo Uploading MEMBERSHIP_ADMIN_PASSWORD to STAGING...
echo %ADMIN_PWD%| npx wrangler secret put MEMBERSHIP_ADMIN_PASSWORD --env staging
if errorlevel 1 (
  echo [FAIL] secret put failed. Deploy staging once with Portal 20b first.
  pause
  exit /b 1
)

echo.
echo ----- 2/2 MEMBERSHIP_SECRET -----
echo Enter MEMBERSHIP_SECRET for staging (16+ random chars):
set /p MEM_SECRET=
if "%MEM_SECRET%"=="" (
  echo [CANCEL] empty
  pause
  exit /b 1
)

echo Uploading MEMBERSHIP_SECRET to STAGING...
echo %MEM_SECRET%| npx wrangler secret put MEMBERSHIP_SECRET --env staging
if errorlevel 1 (
  echo [FAIL] secret put failed
  pause
  exit /b 1
)

echo.
echo ========================================
echo   Done (STAGING)
echo ========================================
echo Open with Portal 21c and login.
echo.
pause
endlocal
exit /b 0
