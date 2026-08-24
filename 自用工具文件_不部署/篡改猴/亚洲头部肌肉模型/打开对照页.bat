@echo off
chcp 65001 >nul
cd /d "%~dp0work_v4\compare_review"
if not exist "index.html" (
  echo [错误] 找不到对照页：%cd%\index.html
  pause
  exit /b 1
)
echo 对照审阅页：http://127.0.0.1:8765/
echo 点顶部「3D预览 GLB」可旋转查看 PROP_v1 / PROP_v2
echo 目录：%cd%
echo 按 Ctrl+C 可停止服务。
start "" "http://127.0.0.1:8765/"
python serve_nocache.py
