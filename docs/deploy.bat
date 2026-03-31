@echo off
echo 正在切换到 D 盘...
d:
echo 正在进入项目目录...
cd "D:\Git仓库位置\PaintingTools"

echo.
echo ---------------------------------------
echo [正在开始增量上传至 soft-voice-f822]
echo 提示：Wrangler 会自动对比哈希值，仅上传改动过的文件。
echo ---------------------------------------
echo.

npx wrangler pages deploy . --project-name=soft-voice-f822

echo.
echo 部署任务结束。
pause