@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

net session >nul 2>&1
if %errorlevel% neq 0 (
  echo 需要管理员权限，正在提权...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

where python >nul 2>&1
if %errorlevel% neq 0 (
  echo 未找到 python，请先安装 Python 3 并加入 PATH。
  pause
  exit /b 1
)

python -c "import cv2,mss,PIL,numpy,pywinauto,pyautogui" 2>nul
if %errorlevel% neq 0 (
  echo 缺少依赖，正在安装 requirements.txt ...
  python -m pip install -r "%~dp0requirements.txt"
  if %errorlevel% neq 0 (
    echo 依赖安装失败，请手动执行: pip install -r requirements.txt
    pause
    exit /b 1
  )
)

echo 启动自动换号监控（日志见 logs 目录）...
echo 若提示已有进程在运行，请先关掉旧的监控窗口或任务管理器里的 python monitor.py
python "%~dp0monitor.py"
pause
