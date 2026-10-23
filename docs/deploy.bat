@echo off
setlocal EnableExtensions
REM Deploy PaintingTools to Cloudflare Worker soft-voice-f822
REM Workers static assets - do NOT use pages deploy
REM ASCII-only bat (UTF-8 Chinese breaks cmd.exe double-click)
REM Set DEPLOY_NOPAUSE=1 to skip final pause (for automated test)

cd /d "%~dp0.."
if errorlevel 1 (
  echo [ERROR] cannot cd to repo root
  goto finish_fail
)

set "LOG=%~dp0last-deploy.log"
> "%LOG%" echo Deploy soft-voice-f822
>>"%LOG%" echo Started: %DATE% %TIME%
>>"%LOG%" echo.

echo.
echo ========================================
echo   Deploy soft-voice-f822 (Worker)
echo ========================================
echo   Log: %LOG%
echo   1) build functions -^> dist/worker
echo   2) wrangler deploy
echo   Please wait; do not close this window.
echo.

where npx >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npx / Node.js not found
  >>"%LOG%" echo [ERROR] npx not found
  goto finish_fail
)

echo [1/2] Building Pages Functions...
>>"%LOG%" echo [1/2] build start
call npx wrangler pages functions build --outdir=./dist/worker
if errorlevel 1 (
  echo [ERROR] functions build failed
  >>"%LOG%" echo [ERROR] functions build failed
  goto finish_fail
)
echo [1/2] build OK
>>"%LOG%" echo [1/2] build OK
echo.

echo [2/2] Deploying Worker + static assets...
>>"%LOG%" echo [2/2] deploy start
call npx wrangler deploy
if errorlevel 1 (
  echo [ERROR] wrangler deploy failed
  >>"%LOG%" echo [ERROR] wrangler deploy failed
  goto finish_fail
)

echo.
echo ========================================
echo   Deploy finished OK
echo ========================================
>>"%LOG%" echo Deploy finished OK: %DATE% %TIME%
echo Log: %LOG%
echo.
goto finish_ok

:finish_fail
echo.
echo *** DEPLOY FAILED - window stays open ***
echo Log: %LOG%
echo.
if /i "%DEPLOY_NOPAUSE%"=="1" goto finish_fail_exit
echo Press any key to close...
pause >nul
:finish_fail_exit
endlocal
exit /b 1

:finish_ok
if /i "%DEPLOY_NOPAUSE%"=="1" goto finish_ok_exit
echo Press any key to close...
pause >nul
:finish_ok_exit
endlocal
exit /b 0
