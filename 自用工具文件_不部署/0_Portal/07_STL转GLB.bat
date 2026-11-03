@echo off
chcp 65001 >nul
cd /d "%~dp0..\STL_to_GLB"
if not exist "STL_to_GLB.bat" (
  echo [错误] 找不到入口: %cd%\STL_to_GLB.bat
  pause
  exit /b 1
)
call "STL_to_GLB.bat" %*
