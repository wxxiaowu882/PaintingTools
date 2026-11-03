@echo off
chcp 65001 >nul
cd /d "%~dp0..\减面和压缩脚本"
if not exist "compressGLB_展示安全.bat" (
  echo [错误] 找不到入口: %cd%\compressGLB_展示安全.bat
  pause
  exit /b 1
)
call "compressGLB_展示安全.bat" %*
