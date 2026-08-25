# Sketchfab → GLB 批量下载

## 推荐：网页控制台（按钮操作）

```bash
cd .cursor/browser-automation
npm run sketchfab:ui
```

自动打开 `http://127.0.0.1:18999/`：

1. 左侧粘贴模型链接列表（可保存）
2. 首次点「打开登录」→ Chrome 里登录 → 回页面点「我已登录完成」
3. 点「开始下载」
4. 右侧看每个模型状态，下方看实时日志（可复制）

默认保存目录：`E:\模型\0820模型下载`（页面上可改）。

## 命令行（备用）

```bash
npm run sketchfab:login
npm run sketchfab:batch -- --list lists/sketchfab-urls.txt
```

## 行为说明

1. 直接进 embed（纯净模式）
2. 注入仓库 `篡改猴Sketchfab.js`
3. 自动贴图 + 导出；必要时强制 `_sf_doDownload`
4. 失败截图在 `.cursor/browser-automation/runs/sketchfab-batch-*/`

## 已知限制

- Sketchfab 主脚本特征码变更时，几何拦截可能失败
- 无下载权的商店模型仍会失败
- 请串行跑，不要并行开多个大模型

## 下载后继续：命名 + 规范 + 压缩（Agent）

若需要「下载完成 → 中文命名 → 旋正 30cm → Draco 压缩」一条龙，不要在本页停；在 Cursor 中 `@` 上级目录的 [`Sketchfab下载到规范化_Agent提示词.md`](../Sketchfab下载到规范化_Agent提示词.md)，并写上链接列表或自然语言任务与输出目录。
