@echo off
setlocal EnableExtensions
REM Open STAGING member-ops (custom domain; China-friendly)
REM ASCII-only.

set "URL=https://test.wuxiaoart.com/member-ops"
echo.
echo ========================================
echo   Member ops (STAGING / TEST)
echo   %URL%
echo ========================================
echo.
echo Login: ops-staging  (Portal 23b)
echo This is NOT production (wuxiaoart.com / www).
echo Fallback if DNS not ready:
echo   https://soft-voice-f822-staging.wxxiaowu.workers.dev/member-ops
echo.
start "" "%URL%"
if errorlevel 1 (
  echo Browser did not open. Open manually:
  echo   %URL%
  pause
)
endlocal
exit /b 0
