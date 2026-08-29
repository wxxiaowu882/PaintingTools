# 对齐叠显 · 历史版本（JSON）

本目录为权威历史存储，供页面加载与 Agent 读取。

- `index.json`：版本清单（新→旧由页面排序）
- `v_*.json`：单版本完整数据（路标点 + preTrs）

写入方式：页面「存为版本」会优先 `POST http://127.0.0.1:18080/__api/align-overlay-history`（需 `npm run serve:repo`）；失败时自动下载 JSON，请把文件放进本目录并更新 `index.json`。
