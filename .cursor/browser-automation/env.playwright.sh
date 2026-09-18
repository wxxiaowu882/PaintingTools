# Playwright 浏览器装在 D 盘，避免占 C 盘。
# 用法：source .cursor/browser-automation/env.playwright.sh
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/d/tools/ms-playwright}"
