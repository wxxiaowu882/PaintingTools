# 自动换号后台监控

Windows 常驻脚本：发现 Cursor 右下角限额 tip 后，驱动「Cursor续杯管家」点「无感换号」，**不重启 Cursor**，再在对话框发送「请继续你的工作」。

**无 AI API**；建议以管理员身份运行（与 `Cursor [管理员]`、管家「管理员运行模式」对齐）。

## 怎么启动

1. 安装 Python 3，并确保 `python` 在 PATH 中。
2. **先打开「Cursor续杯管家」**（须可见，不要只靠托盘）。
3. 首次可双击 `启动_自动换号监控.bat`（会提权；缺依赖时自动 `pip install -r requirements.txt`）。
   若已有旧监控在跑，**会自动结束旧进程并接管**，不必再手动关 `python monitor.py`。
4. 或手动：

```bat
cd /d "自用工具文件_不部署\自动换号"
pip install -r requirements.txt
python monitor.py
```

## 行为摘要

| 阶段 | 行为 |
|------|------|
| 监控 | 约 2 秒一轮；用量上限 / 恢复会话失败 → 无感换号（检出即执行） |
| **更新提示** | **Update recommended / Update Available 一律只关闭（Close / × / Esc），绝不点 Update 或 Download Update，不换号**；与用量 tip 严格区分；**仅在 Cursor 窗口内**扫 |
| Connection Error（普通） | 关 tip → 输入「刚才网络断了，现在请继续」并 Ctrl+Enter（不换号） |
| **Too many free trials** | 点管家「重置机器码」→「确认重置」确定 →「强制关闭 Cursor」确定 → **等重启** → 开工程 → 发「请继续你的工作」→ 宽限 |
| **无感换号** | 关 tip → 全部保存 → 前置续杯管家 → 点「无感换号」→ 等待约 5 秒 → **不重启** → 工程窗置前 → 发「请继续你的工作」→ 宽限 |
| 宽限内（续写后 2 分钟） | 用量 tip 忽略；Connection Error 仍走网络续写；更新提示仍关闭 |
| 换号中 | 忽略新 tip，避免连点 |
| 管家未开 / 点不到按钮 | 失败冷却，不发继续语 |

工程路径固定：`D:\Git仓库位置\PaintingTools`（可在 `config.py` 改）。续写文案：`CONTINUE_PROMPT`。

## 日志

- 目录：`logs/监控_YYYYMMDD.log`
- 同时打印到控制台；字段为中文（状态 / 提示类型 / 动作 / 成败）

示例：

```text
[09:47:12] 状态 监控中
[09:47:15] 提示 用量上限 动作=换号
[09:47:16] 点击 无感换号 结果=成功 方式=窗口内模板
[09:47:22] 续写 结果=成功 内容=请继续你的工作
[09:47:22] 宽限 开始 结束于=09:49:22
```

## 怎么换模板

管家是 WebView，按钮无 UIA，靠 `templates/btn_seamless_switch.png`（「无感换号」四字）在管家窗内匹配。

| 文件 | 用途 |
|------|------|
| `btn_seamless_switch.png` | 「无感换号」按钮（窗内匹配） |
| `btn_reset_machine.png` | 红色「重置机器码 (Too many free trials)」 |
| `dlg_confirm_reset.png` | 「确认重置」弹窗标题 |
| `dlg_force_close_cursor.png` | 「关闭 Cursor」弹窗标题 |
| `dlg_force_close_body.png` | 「是否强制关闭…」正文（兜底） |
| `btn_mgr_confirm_ok.png` | 弹窗蓝色「确定」 |
| `tip_too_many_free.png` | 「Too many free trial accounts…」正文 |
| `tip_usage_limit.png` | 「You've hit your usage limit」 |
| `tip_upgrade_btn.png` | Upgrade to Pro（辅助） |
| `tip_error_resume.png` | 「Error resuming chat」 |
| `tip_close_x.png` | tip 右上角关闭 |
| `dlg_update_*.png` / `btn_*update*` | 更新提示只关不点 Update（见既有说明） |

分辨率或管家皮肤变了导致匹配失败时：从新截图裁「无感换号」覆盖同名文件，必要时在 `config.py` 调 `SEAMLESS_SWITCH_THRESHOLD` / `SEAMLESS_SWITCH_WAIT`。

旧「登录助手 / 刷新 Cursor」相关模板可保留，新流程不再调用。

## 内存与稳定性

- 模板会缓存在内存；替换 `templates/` 后请**重启监控**才生效。
- 主循环遇 OpenCV 内存不足会自动 GC 并短暂退避。
- 「Cursor续杯管家」标题含 Cursor，已从编辑器窗口枚举中排除，避免误前置。

## 验收建议

1. 续杯管家已开；贴 tip 或真实触发：日志「提示 用量上限」→「点击 无感换号 结果=成功」
2. Cursor **不重启**；日志有「等待生效」与「续写 结果=成功 内容=请继续你的工作」→「宽限 开始」
3. 管家未开时：日志「未找到」/ 点击失败，不发继续语
4. 宽限内 tip 忽略；宽限后再 tip 再走无感换号
5. 更新弹窗仍只关、不换号；Connection Error 仍网络续写
