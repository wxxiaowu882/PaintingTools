# Cursor Hooks（本仓库）

机器强制约束；与模式 1 / Skills 配合。配置：仓库根 `.cursor/hooks.json`。

## 已启用

| 事件 | 脚本 | 作用 |
|------|------|------|
| `preToolUse`（Write / StrReplace / Delete / EditNotebook） | `hooks/protect-docs-json.js` | 拦截对手改 `docs/json` 权威产物 |
| `beforeShellExecution` | `hooks/protect-docs-json-shell.js` | 拦截重定向 / sed 等疑似手改 `docs/json`；**允许** `node …/scripts`、`npm run` 等生成脚本 |
| `afterShellExecution` | `hooks/after-shell-fail-mark.js` | 识别 `FAILED in shell` / wait 失败等，写入临时标记（系统临时目录，不进仓库） |
| `stop` | `hooks/stop-cleanup-remind.js` | ① 有失败标记或异常停住 → 自动智能续跑（**最多连续 2 次**）；② 否则若 `browser-automation/runs/` 有疑似临时文件 → 清理提醒。`loop_limit: 2`，用户手动 Abort 不续 |

## 设计取舍

- **不**在 hook 里直接删文件（避免误删证据）；清理仍由 Agent 执行。
- **不**做「往聊天输入框打『继续』」的 UI 监控：改走官方 `stop` → `followup_message`，更稳、可控。
- 自动续跑最多连续**两次**（第一次仍失败再跟一次），话术要求「勿重复已成功步骤 / 勿再死等同一字符串」，避免无限空转烧额度。
- JSON 保护 fail-open：脚本异常时不拖死 Agent；真正拦截靠返回 `permission: "deny"`。
- 生产工具生成 JSON：走 Shell + 脚本，不被 Write 工具路径拦住。

## 自测（可选）

在仓库根：

```bash
echo '{"tool_name":"Write","tool_input":{"path":"docs/json/foo.json"}}' | node .cursor/hooks/protect-docs-json.js
# 期望含 "deny"

echo '{"tool_name":"Write","tool_input":{"path":"Solid.html"}}' | node .cursor/hooks/protect-docs-json.js
# 期望含 "allow"

echo '{"command":"echo hi > docs/json/x.json"}' | node .cursor/hooks/protect-docs-json-shell.js
# 期望含 "deny"
```

改 hooks 后若未生效：新开 Agent 会话再试。
