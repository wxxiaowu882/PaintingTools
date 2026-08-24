# 自动换号后台监控

Windows 常驻脚本：发现 Cursor 右下角限额 tip 后，驱动「Cursor 登录助手」换号，再重新打开 `PaintingTools`。

**无 AI API**；建议以管理员身份运行（与 `Cursor [管理员]` 对齐）。

## 怎么启动

1. 安装 Python 3，并确保 `python` 在 PATH 中。
2. 首次可双击 `启动_自动换号监控.bat`（会提权；缺依赖时自动 `pip install -r requirements.txt`）。
3. 或手动：

```bat
cd /d "自用工具文件_不部署\自动换号"
pip install -r requirements.txt
python monitor.py
```

4. 保持「Cursor 登录助手」已打开；监控会按窗口标题前置它（不要依赖任务栏图标）。

## 行为摘要

| 阶段 | 行为 |
|------|------|
| 监控 | 约 2 秒一轮；命中 tip 且不在宽限内 → 换号 |
| 宽限内（打开工程后 2 分钟） | 两种 tip 都只关闭，不换号 |
| 换号中 | 忽略新 tip，避免连点 |
| 换号前 | 对 Cursor「全部保存」 |
| 助手 | 点「刷新 Cursor」；若出现「确认换号」则点 |
| 打开工程 | 先 `cursor "路径"` / `D:\cursor\Cursor.exe`，失败再点 Recent 里的 PaintingTools |
| 打开后 | 先清一次 tip → 再开始 2 分钟宽限 |

工程路径固定：`D:\Git仓库位置\PaintingTools`（可在 `config.py` 改）。

## 日志

- 目录：`logs/监控_YYYYMMDD.log`
- 同时打印到控制台；字段为中文（状态 / 提示类型 / 动作 / 成败）

示例：

```text
[09:47:12] 状态 监控中
[09:47:15] 提示 用量上限 动作=换号
[09:47:28] 宽限 开始 结束于=09:49:28
```

## 怎么换模板

参考图 `01.png`～`04.png` 保留作对照。真正匹配用的是 `templates/` 下小图：

| 文件 | 用途 |
|------|------|
| `tip_usage_limit.png` | 「You've hit your usage limit」 |
| `tip_upgrade_btn.png` | Upgrade to Pro（辅助） |
| `tip_error_resume.png` | 「Error resuming chat」 |
| `tip_close_x.png` | tip 右上角关闭 |
| `btn_refresh_cursor*.png` | 刷新 Cursor（UIA 失败时兜底） |
| `btn_confirm_switch.png` | 确认换号 |
| `btn_editor_window.png` | Editor Window |
| `btn_paintingtools.png` / `lbl_recent_projects.png` | 欢迎页打开工程 |

分辨率或主题变了导致匹配失败时：从新截图裁出对应小图覆盖同名文件，必要时在 `config.py` 调 `MATCH_THRESHOLD` / `TIP_MATCH_THRESHOLD`。

暗色主题未做第二套模板；若你常用暗色，另补一套再说。

## 验收建议

1. 贴 tip 或真实触发：日志出现「提示 用量上限」或「提示 恢复会话失败」
2. 能前置登录助手并点到「刷新 Cursor」；有确认框时能点「确认换号」
3. Cursor 重启后能打开 PaintingTools；日志有「打开后清提示」与「宽限 开始」
4. 宽限内 tip 只关不换号；宽限后再 tip 走完整换号
