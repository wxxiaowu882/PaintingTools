# Cursor Hooks（本仓库）

机器强制约束；与模式 1 / Skills 配合。配置：仓库根 `.cursor/hooks.json`。

## 已启用

| 事件 | 脚本 | 作用 |
|------|------|------|
| `preToolUse`（Write / StrReplace / Delete / EditNotebook） | `hooks/protect-docs-json.js` | 拦截对手改 `docs/json` 权威产物 |
| `beforeShellExecution` | `hooks/protect-docs-json-shell.js` | 拦截重定向 / sed 等疑似手改 `docs/json`；**允许** `node …/scripts`、`npm run` 等生成脚本 |
| `stop` | `hooks/stop-cleanup-remind.js` | 若 `browser-automation/runs/` 有疑似临时文件，自动跟进一条清理提醒（每会话最多 1 次） |

## 设计取舍

- **不**在 hook 里直接删文件（避免误删证据）；清理仍由 Agent 执行。
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
