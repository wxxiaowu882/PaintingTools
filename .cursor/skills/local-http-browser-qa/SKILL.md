---
name: local-http-browser-qa
description: >-
  Starts local HTTP for this repo and drives browser checks/screenshots with
  Playwright conventions. Use when opening Solid, Portrait, production tools,
  taking QA screenshots, or any page test that must not use file://.
---

# 本地 HTTP + 浏览器截图

## 硬规则

1. 仓库页面用**本地 HTTP**，禁止默认 `file://`。
2. 截图与临时产物放 `.cursor/browser-automation/runs/`，勿散落到业务目录。
3. 任务结束只留有价值证据，其余即时删除。
4. 静态服务**不要**用 `serve -s`（会误改 HTML 路由）。

## 推荐步骤

1. 在 `.cursor/browser-automation/` 起仓库根静态服务（常见端口 **18080**；以该目录 `package.json` 的 `serve:repo` 为准）。
2. URL 用无 `.html` 后缀的站内形式（如 `/Solid`、`/Solid?sandbox=headform`）；磁盘文件名仍可是 `*.html`。
3. Playwright：优先本机 Edge（`PLAYWRIGHT_CHANNEL=msedge`）；见 `env.playwright.sh` 与 `_playwright-browsers-path.js`。
4. Solid / 生产端加载：等 `#scene-loader` 消失后再缓冲 1–2 秒再操作或截图。
5. 生产端标注工具优先原生 `#tool-mode-select`；经典引出线默认 `Alt+Shift+拖拽`。
6. 详细坑点与脚本索引：读 `.cursor/browser-automation/README.md`（按任务搜关键词，勿整文件空读）。

## 与模式 1

- verifier / 主 Agent 做页面验收时默认走本 skill。
- 涉及标注对错时，截图后交接 `annotation-vision-qa` 做 AI 读图。

## 汇报要点

- 服务根目录与端口
- 打开的完整 URL
- 截图路径（`runs/` 下）
- 已清理的过程文件（若有）
