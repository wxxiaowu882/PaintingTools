@echo off
setlocal EnableExtensions
REM Portal entry: call docs\deploy.bat
REM ASCII-only - UTF-8 Chinese breaks cmd.exe when double-clicked

title PaintingTools Deploy
echo.
echo ========================================
echo   Site deploy to Cloudflare
echo ========================================
echo.
echo Uploads repo to Worker soft-voice-f822.
echo May take 1+ minutes. Do not close this window.
echo Log file: docs\last-deploy.log
echo.

set "DEPLOY_BAT=%~dp0..\..\docs\deploy.bat"
if not exist "%DEPLOY_BAT%" (
  echo [ERROR] deploy.bat not found:
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
  echo [RESULT] OK
)
echo If the window closed too fast, open:
echo   docs\last-deploy.log
echo.
if /i "%DEPLOY_NOPAUSE%"=="1" goto done
echo Press any key to close...
pause >nul
:done
endlocal
exit /b %ERR%
