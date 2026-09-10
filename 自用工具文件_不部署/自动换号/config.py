# -*- coding: utf-8 -*-
"""自动换号监控：路径与超时等配置。"""
from __future__ import annotations

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
TEMPLATES_DIR = BASE_DIR / "templates"
LOGS_DIR = BASE_DIR / "logs"

# 工程与 Cursor
PROJECT_PATH = r"D:\Git仓库位置\PaintingTools"
CURSOR_EXE_CANDIDATES = [
    r"D:\cursor\Cursor.exe",
    os.path.expandvars(r"%LOCALAPPDATA%\Programs\cursor\Cursor.exe"),
    os.path.expandvars(r"%LOCALAPPDATA%\Programs\Cursor\Cursor.exe"),
    r"C:\Program Files\Cursor\Cursor.exe",
]

# 窗口标题关键字
ASSIST_TITLE = "Cursor 登录助手"
CURSOR_TITLE = "Cursor"
CONFIRM_TITLE_HINTS = ("确认换号", "确认换号登录")

# 轮询与超时（秒）
POLL_INTERVAL = 2.0
# 换号成功并续写后的静默期
GRACE_SECONDS = 120
# 宽限结束后仍须连续 N 次检出同一 tip 才换号，过滤单次误匹配
TIP_CONFIRM_POLLS = 5
CONFIRM_WAIT_SECONDS = 20
# 点「刷新」后，Cursor 窗口须先消失再出现才算重启成功
CURSOR_GONE_TIMEOUT = 45
CURSOR_RESTART_TIMEOUT = 90
# 重启后主界面（含 Editor Window）可能晚几秒才画出来
EDITOR_WINDOW_WAIT = 25
OPEN_PROJECT_TIMEOUT = 25
CURSOR_UI_READY_WAIT = 12
# 换号失败后冷却，避免狂点助手
SWITCH_FAIL_COOLDOWN = 15

# 模板匹配
MATCH_THRESHOLD = 0.82
TIP_MATCH_THRESHOLD = 0.82
# 主屏右下角 ROI（相对宽高比例），用于 tip 检测
TIP_ROI_REL = (0.45, 0.55, 1.0, 0.98)  # left, top, right, bottom

# tip 关闭：优先在 tip 命中框右侧搜 ×；偏移为相对 tip 框右上角的像素（回退）
TIP_CLOSE_OFFSET = (12, 12)  # 从 tip 框右上角向内偏

CONTINUE_PROMPT = "请继续你的工作"
# Connection Error（网络中断）时发送，不换号
NETWORK_RESUME_PROMPT = "刚才网络断了，现在请继续"
# 网络续写：连续确认次数（比换号少，尽快恢复）
CONN_RESUME_CONFIRM_POLLS = 2
# 网络续写成功后冷却，避免同一 tip 连发
CONN_RESUME_COOLDOWN = 45
# chat 输入框安全点击点（相对工程窗口）：
# x 略靠中右，y 贴近底部，避免误点右侧 Files 列表
CHAT_INPUT_REL = (0.64, 0.96)

# Tip 类型中文名
TIP_TYPE_CN = {
    "usage_limit": "用量上限",
    "error_resume": "恢复会话失败",
    "connection_error": "连接错误",
    "chat_toast": "聊天提示",
}

# 打开工程后清 tip：右下角 chat 区相对比例
POST_OPEN_TIP_ROI = (0.50, 0.45, 1.0, 0.96)

# Connection Error 浮层在 chat 输入框上方；有 Review 栏时会略偏上
CONN_TOAST_Y_BAND = (0.62, 0.92)  # 命中框纵向中心，占整屏高度比例
# 用量上限 / 恢复会话失败 toast 也在 chat 输入框上方，排除顶栏 Upgrade to Pro
CHAT_TOAST_Y_BAND = (0.68, 0.90)
# 正文「Get Cursor Pro…」模板阈值
CONN_BODY_ONLY_THRESHOLD = 0.78
# 警示图标共现（现多为灰色三角，非黄）
CONN_ICON_MIN_SCORE = 0.60
# 模板来自截图放大，实机 DPI 可能略偏，做多尺度匹配
MATCH_SCALES = (0.78, 0.86, 0.93, 1.0, 1.08, 1.16)
# 换号后等待 Connection Error 出现再网络续写（秒）
POST_OPEN_CONN_WAIT = 20
