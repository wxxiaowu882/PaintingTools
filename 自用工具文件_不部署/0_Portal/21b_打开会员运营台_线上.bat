@echo off
setlocal EnableExtensions
REM Open PRODUCTION member-ops in browser
REM ASCII-only

set "URL=https://wuxiaoart.com/member-ops"
echo.
echo ========================================
echo   Member ops (PRODUCTION)
echo   %URL%
echo ========================================
echo.
echo Use Portal 23 password (production).
echo For Cloudflare TEST site use Portal 21c.
echo.
start "" "%URL%"
if errorlevel 1 (
  echo Browser did not open. Open manually:
  echo   %URL%
  pause
)
endlocal
exit /b 0
