@echo off
chcp 65001 >nul
cd /d "%~dp0..\Gallery生成"
if not exist "Gallery生成.bat" (
  echo [错误] 找不到入口: %cd%\Gallery生成.bat
  pause
  exit /b 1
)
call "Gallery生成.bat" %*
