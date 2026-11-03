@echo off
chcp 65001 >nul
cd /d "%~dp0..\减面和压缩脚本"
if not exist "Blender减面脚本.cmd" (
  echo [错误] 找不到入口: %cd%\Blender减面脚本.cmd
  pause
  exit /b 1
)
call "Blender减面脚本.cmd" %*
