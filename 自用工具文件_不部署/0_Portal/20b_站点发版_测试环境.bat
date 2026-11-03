@echo off
setlocal EnableExtensions
REM Portal: deploy STAGING only (soft-voice-f822-staging)
REM ASCII-only

title PaintingTools Deploy STAGING
echo.
echo ========================================
echo   STAGING site deploy (NOT production)
echo ========================================
echo.
echo Uploads repo to Worker soft-voice-f822-staging.
echo Production soft-voice-f822 is NOT touched.
echo May take 1+ minutes. Do not close this window.
echo Log: docs\last-deploy-staging.log
echo.

set "DEPLOY_BAT=%~dp0..\..\docs\deploy-staging.bat"
if not exist "%DEPLOY_BAT%" (
  echo [ERROR] deploy-staging.bat not found:
  echo   %DEPLOY_BAT%
  echo.
  if /i "%DEPLOY_NOPAUSE%"=="1" exit /b 1
  echo Press any key to close...
  pause >nul
  exit /b 1
)

echo Calling: %DEPLOY_BAT%
echo.
call "%DEPLOY_BAT%"
set "ERR=%ERRORLEVEL%"

echo.
echo ----------------------------------------
if not "%ERR%"=="0" (
  echo [RESULT] FAILED exit code %ERR%
) else (
  echo [RESULT] OK - STAGING
)
echo.
if /i "%DEPLOY_NOPAUSE%"=="1" goto done
echo Press any key to close...
pause >nul
:done
endlocal
exit /b %ERR%
