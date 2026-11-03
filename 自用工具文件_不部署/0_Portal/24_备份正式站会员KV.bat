@echo off
setlocal EnableExtensions
REM Portal: encrypt-backup production MEMBERSHIP_KV to 历史备份文件/membership-kv/
REM ASCII-only bat

title PaintingTools Membership KV Backup
echo.
echo ========================================
echo   Backup prod membership KV (encrypted)
echo ========================================
echo   Output: 历史备份文件\membership-kv\
echo   Key:    历史备份文件\membership-kv\_backup.key
echo.

cd /d "%~dp0..\.."
if errorlevel 1 (
  echo [ERROR] cannot cd to repo root
  goto finish_fail
)

where npx >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npx / Node.js not found
  goto finish_fail
)

set KV_BACKUP_TRIGGER=portal-24
call node "docs\membership\backup-membership-kv.mjs" --env=prod
set "ERR=%ERRORLEVEL%"
set KV_BACKUP_TRIGGER=

echo.
if not "%ERR%"=="0" (
  echo [RESULT] FAILED
  goto finish_fail
)
echo [RESULT] OK
echo Decrypt tip: node docs\membership\backup-membership-kv.mjs --decrypt=历史备份文件\membership-kv\xxx.enc.json
echo.
if /i "%DEPLOY_NOPAUSE%"=="1" goto done
echo Press any key to close...
pause >nul
:done
endlocal
exit /b 0

:finish_fail
echo.
if /i "%DEPLOY_NOPAUSE%"=="1" exit /b 1
echo Press any key to close...
pause >nul
endlocal
exit /b 1
