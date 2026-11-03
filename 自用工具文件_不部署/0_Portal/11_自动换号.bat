@echo off
chcp 65001 >nul
cd /d "%~dp0..\自动换号"
if not exist "启动_自动换号监控.bat" (
  echo [错误] 找不到入口: %cd%\启动_自动换号监控.bat
  pause
  exit /b 1
)
call "启动_自动换号监控.bat" %*
