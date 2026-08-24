@echo off
cd /d "%~dp0work_v4\compare_review"
if not exist "index.html" (
  echo [ERROR] missing index.html in:
  echo   %cd%
  pause
  exit /b 1
)
where python >nul 2>&1
if errorlevel 1 (
  echo [ERROR] python not found in PATH
  pause
  exit /b 1
)
echo Starting compare review...
echo URL: http://127.0.0.1:8765/
echo Keep this window open. Close it or Ctrl+C to stop.
echo.
python serve_nocache.py
if errorlevel 1 (
  echo.
  echo [ERROR] server failed to start
  pause
  exit /b 1
)
