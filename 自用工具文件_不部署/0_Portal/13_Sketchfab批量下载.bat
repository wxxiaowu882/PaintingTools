@echo off
chcp 65001 >nul
cd /d "%~dp0..\..\.cursor\browser-automation"
if not exist "启动_Sketchfab批量下载.bat" (
  echo [错误] 找不到: %cd%\启动_Sketchfab批量下载.bat
  pause
  exit /b 1
)
call "启动_Sketchfab批量下载.bat" %*
