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
echo   0) preflight secrets + probe off
echo   1) bump site version stamp + sync policy
echo   2) build functions -^> dist/worker
echo   3) wrangler deploy --env=""  ^(prod^)
echo   4) post-deploy smoke
echo   Please wait; do not close this window.
echo.

where npx >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npx / Node.js not found
  >>"%LOG%" echo [ERROR] npx not found
  goto finish_fail
)

echo [0/4] Preflight (secrets + probe off)...
>>"%LOG%" echo [0/4] preflight start
if /i "%SKIP_PREFLIGHT%"=="1" (
  echo [0/4] SKIP_PREFLIGHT=1, skip
  >>"%LOG%" echo [0/4] skipped
) else (
  call node "docs\membership\prod-deploy-preflight.mjs"
  if errorlevel 1 (
    echo [ERROR] preflight failed
    >>"%LOG%" echo [ERROR] preflight failed
    goto finish_fail
  )
  echo [0/4] preflight OK
  >>"%LOG%" echo [0/4] preflight OK
)
echo.

echo [1/4] Bump site stamp + sync membership policy/tiers...
>>"%LOG%" echo [1/4] site-version + policy sync start
if /i "%SKIP_SITE_VERSION_BUMP%"=="1" (
  echo [1/4a] SKIP_SITE_VERSION_BUMP=1, skip stamp
  >>"%LOG%" echo [1/4a] site-version skipped
) else (
  call node "docs\site-version-bump.mjs"
  if errorlevel 1 (
    echo [ERROR] site-version bump failed
    >>"%LOG%" echo [ERROR] site-version bump failed
    goto finish_fail
  )
  echo [1/4a] site-version bump OK
  >>"%LOG%" echo [1/4a] site-version OK
)
if /i "%SKIP_POLICY_SYNC%"=="1" (
  echo [1/4b] SKIP_POLICY_SYNC=1, skip
  >>"%LOG%" echo [1/4b] policy skipped
) else (
  call node "docs\membership\sync-policy-staging-to-prod.mjs"
  if errorlevel 1 (
    echo [ERROR] policy sync failed
    >>"%LOG%" echo [ERROR] policy sync failed
    goto finish_fail
  )
  echo [1/4b] policy sync OK
  >>"%LOG%" echo [1/4b] policy sync OK
)
echo.

echo [2/4] Building Pages Functions...
>>"%LOG%" echo [2/4] build start
call npx wrangler pages functions build --outdir=./dist/worker
if errorlevel 1 (
  echo [ERROR] functions build failed
  >>"%LOG%" echo [ERROR] functions build failed
  goto finish_fail
)
echo [2/4] build OK
>>"%LOG%" echo [2/4] build OK
echo.

echo [3/4] Deploying Worker + static assets (prod top-level env)...
>>"%LOG%" echo [3/4] deploy start
REM Explicit empty --env selects wrangler.toml top-level (prod), not staging
call npx wrangler deploy --env=""
if errorlevel 1 (
  echo [ERROR] wrangler deploy failed
  >>"%LOG%" echo [ERROR] wrangler deploy failed
  goto finish_fail
)

echo.
echo [4/4] Post-deploy smoke (prod)...
>>"%LOG%" echo [4/4] smoke start
call node "docs\membership\prod-deploy-smoke.mjs"
if errorlevel 1 (
  echo [ERROR] smoke failed - deploy may have uploaded but checks failed
  >>"%LOG%" echo [ERROR] smoke failed
  goto finish_fail
)
echo [4/4] smoke OK
>>"%LOG%" echo [4/4] smoke OK

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
