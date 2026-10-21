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
echo 请先打开「Cursor续杯管家」并保持窗口可见（不要缩到托盘）。
echo 用量 tip 时会点「无感换号」，不重启 Cursor，再发「请继续你的工作」。
echo 若已有旧监控在跑，将自动结束旧进程并接管，无需手动关闭。
python "%~dp0monitor.py"
pause
