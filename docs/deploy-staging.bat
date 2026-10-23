@echo off
setlocal EnableExtensions
REM Deploy PaintingTools to Cloudflare STAGING Worker soft-voice-f822-staging
REM Does NOT touch production soft-voice-f822
REM ASCII-only bat
REM Set DEPLOY_NOPAUSE=1 to skip final pause

cd /d "%~dp0.."
if errorlevel 1 (
  echo [ERROR] cannot cd to repo root
  goto finish_fail
)

set "LOG=%~dp0last-deploy-staging.log"
> "%LOG%" echo Deploy soft-voice-f822-staging
>>"%LOG%" echo Started: %DATE% %TIME%
>>"%LOG%" echo.

echo.
echo ========================================
echo   STAGING deploy (NOT production)
echo   Worker: soft-voice-f822-staging
echo ========================================
echo   Log: %LOG%
echo   1) build functions -^> dist/worker
echo   2) wrangler deploy --env staging
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

echo [2/2] Deploying STAGING Worker + static assets...
>>"%LOG%" echo [2/2] deploy --env staging start
call npx wrangler deploy --env staging
if errorlevel 1 (
  echo [ERROR] wrangler deploy --env staging failed
  >>"%LOG%" echo [ERROR] wrangler deploy failed
  goto finish_fail
)

echo.
echo ========================================
echo   STAGING deploy finished OK
echo ========================================
>>"%LOG%" echo Deploy finished OK: %DATE% %TIME%
echo Log: %LOG%
echo Open ops: Portal 21c  or
echo   https://test.wuxiaoart.com/member-ops
echo Fallback: soft-voice-f822-staging.*.workers.dev/member-ops
echo.
goto finish_ok

:finish_fail
echo.
echo *** STAGING DEPLOY FAILED - window stays open ***
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
