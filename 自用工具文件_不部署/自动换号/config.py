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
ASSIST_TITLE = "Cursor 登录助手"  # 旧工具；新流程已改用续杯管家，仅作排除/兼容
MANAGER_TITLE = "Cursor续杯管家"
MANAGER_TITLE_SHORT = "续杯管家"
CURSOR_TITLE = "Cursor"
CONFIRM_TITLE_HINTS = ("确认换号", "确认换号登录")
# 无感换号按钮文案（WebView 无 UIA，实际靠 templates/btn_seamless_switch.png）
SEAMLESS_SWITCH_LABEL = "无感换号"
SEAMLESS_SWITCH_THRESHOLD = 0.80
# 近失放宽：曾用 0.68～0.72 误点窗底 y≈1374，现关闭（仅≥阈值才点）
SEAMLESS_SWITCH_SOFT_OK = 0.92
# 点无感换号后、切回 Cursor 前：极短暂等 token（秒）
SEAMLESS_SWITCH_WAIT = 0.35
# 切回 Cursor 后落稳（秒）；之后立刻快关 tip + 续写
SEAMLESS_AFTER_FRONT = 0.08
# 管家最大化后、点击前等待 WebView 就绪
SEAMLESS_PRECLICK_WAIT = 0.45
# 单击后等待「已切换」/账号变化
SEAMLESS_VERIFY_WAIT = 1.4
# 管家窗 OCR 最大宽
MANAGER_OCR_MAX_WIDTH = 1200
# 无感换号 Y：用「距底边比例」——同按钮在 1119 高窗约 0.19、在 1399 高窗约 0.35（相对顶会漂）
# 拒中部发送条（距底>~0.45）与贴底假阳（距底<0.08）
SEAMLESS_HIT_FROM_BOTTOM = (0.10, 0.42)
# 蓝钮兜底：与 HIT 同距底带（v15.7.5 最大化时底钮约 from_b≈0.37，旧 0.30 会扫空）
SEAMLESS_BLUE_FROM_BOTTOM = (0.10, 0.42)
# 无感换号相对窗宽：右栏底钮左起第一颗约 0.51～0.63；拒「指定路径」(~0.75+)
SEAMLESS_HIT_X_MIN = 0.45
SEAMLESS_HIT_X_MAX = 0.72
# OCR/模板均空时：再等 WebView 一拍后重截一次（不连点，只重定位）
SEAMLESS_RELOCATE_WAIT = 0.7

# 轮询与超时（秒）
POLL_INTERVAL = 2.0
# 换号成功并续写后的短静默（防同一次 tip 连点）；期内高分用量 tip 仍会再换号
GRACE_SECONDS = 12
# 宽限内再次触发换号的最低分数（真实用量 tip，避开 chat 历史误匹配）
GRACE_USAGE_RERUN_MIN_SCORE = 0.86
# 用量 tip：检出即换号（1=立刻；曾用 2 防误匹配，现按业务要求立即执行）
TIP_CONFIRM_POLLS = 1
CONFIRM_WAIT_SECONDS = 20
# 以下为旧「登录助手刷新→重启 Cursor」路径保留；新无感换号流程不再依赖
CURSOR_GONE_TIMEOUT = 45
CURSOR_RESTART_TIMEOUT = 90
EDITOR_WINDOW_WAIT = 25
OPEN_PROJECT_TIMEOUT = 25
CURSOR_UI_READY_WAIT = 12
# 换号失败后冷却，避免狂点管家
SWITCH_FAIL_COOLDOWN = 15

# 模板匹配
MATCH_THRESHOLD = 0.82
TIP_MATCH_THRESHOLD = 0.82
# 主屏右下角 ROI（相对宽高比例），用于 tip 检测
TIP_ROI_REL = (0.45, 0.55, 1.0, 0.98)  # left, top, right, bottom
# 用量 tip：RapidOCR 语义检测（主路径）；模板仅兜底
USAGE_OCR_ENABLED = True
USAGE_OCR_Y_CROP = 0.20  # 只扫 tip ROI 中下部
USAGE_OCR_MAX_WIDTH = 960  # OCR 输入最大宽，加速

# tip 关闭：优先在 tip 命中框右侧搜 ×；偏移为相对 tip 框右上角的像素（回退）
TIP_CLOSE_OFFSET = (12, 12)  # 从 tip 框右上角向内偏

CONTINUE_PROMPT = "请继续你的工作"
# Connection Error（网络中断）时发送，不换号
NETWORK_RESUME_PROMPT = "刚才网络断了，现在请继续"
# 网络续写：连续确认次数（比换号少，尽快恢复）
CONN_RESUME_CONFIRM_POLLS = 2
# 网络续写成功后冷却，避免同一 tip 连发
CONN_RESUME_COOLDOWN = 45
# Too many free trials → 重置机器码（会强制关 Cursor 并重启）
TOO_MANY_FREE_THRESHOLD = 0.72
RESET_MACHINE_THRESHOLD = 0.75
MGR_DIALOG_THRESHOLD = 0.72
MGR_CONFIRM_WAIT = 12.0  # 等「确认重置 / 强制关闭」弹窗
RESET_MACHINE_COOLDOWN = 90  # 重置流程后冷却，防连点
# chat 输入框安全点击点（相对工程窗口）：
# x 略靠中右，y 贴近底部，避免误点右侧 Files 列表
CHAT_INPUT_REL = (0.64, 0.96)

# Tip 类型中文名
# 注意：update_prompt（更新提示）不是 tip，不进换号；仅日志/文档对照用
TIP_TYPE_CN = {
    "usage_limit": "用量上限",
    "error_resume": "恢复会话失败",
    "connection_error": "连接错误",
    "too_many_free": "机器码限制",
    "chat_toast": "聊天提示",
    "update_prompt": "更新提示",
}

# 打开工程后清 tip：右下角 chat 区相对比例
POST_OPEN_TIP_ROI = (0.50, 0.45, 1.0, 0.96)

# Connection Error 浮层在 chat 输入框上方；有 Review 栏时会略偏上
CONN_TOAST_Y_BAND = (0.62, 0.92)  # 命中框纵向中心，占整屏高度比例
# 用量上限 / 恢复会话失败 toast；与连接错误同区，略放宽以适配新版 tip
CHAT_TOAST_Y_BAND = (0.60, 0.94)
# 正文「Get Cursor Pro…」模板阈值
CONN_BODY_ONLY_THRESHOLD = 0.78
# 警示图标共现（现多为灰色三角，非黄）
CONN_ICON_MIN_SCORE = 0.60
# 模板来自截图放大，实机 DPI 可能略偏，做多尺度匹配
# 常态只跑前 3 档；接近阈值时再补跑其余（省内存、加速无 tip 轮询）
# 含偏小尺度：压缩截图/不同 DPI 下 tip 可能只有模板的 ~0.45～0.7
MATCH_SCALES = (1.0, 0.93, 1.08, 0.86, 0.78, 1.16, 0.70, 0.55, 0.48, 1.25)
MATCH_SCALES_PRIMARY = 4
# 主循环：每 N 轮才扫一次更新广告，且短超时，避免拖死 tip 检测
UPDATE_DISMISS_EVERY_POLLS = 15
UPDATE_DISMISS_POLL_TIMEOUT = 0.35
# 1.0 尺度已明显高于阈值时早退，少做其它尺度
MATCH_EARLY_EXIT_MARGIN = 0.04
# 主档最高分距阈值这么近时，再试其余尺度
MATCH_NEAR_MISS = 0.06
# 外部网站弹窗用更少尺度（ROI 更大，易 OOM）
DIALOG_MATCH_SCALES = (1.0, 0.93)
# 更新提示：仅在 Cursor 窗口内扫；相对「该窗口」的子 ROI（避免 Chrome 误点）
UPDATE_DIALOG_ROIS = (
    (0.15, 0.02, 0.85, 0.55),  # 窗内上中（Update recommended）
    (0.40, 0.50, 1.0, 0.98),  # 窗内右下（Update Available）
)
# 右下角 Update Available 专用：略抬高以覆盖 EOL toast（曾贴在终端上方）
UPDATE_AVAILABLE_ROI = (0.45, 0.55, 1.0, 0.99)
# 模板来自约 1024 宽压缩图；实机 Cursor 常 ~2000+ 宽，须含 2.1～2.3 档
UPDATE_DIALOG_MATCH_SCALES = (2.15, 2.0, 2.3, 1.8, 1.5, 1.0, 1.25, 0.93)
# Available 快路径：覆盖常见窗宽（约 1600～2178）
# 实机曾用 ~1742 宽，仅 2.15/2.0/1.0 会全部低于阈值 → 永远关不掉
UPDATE_AVAILABLE_FAST_SCALES = (1.7, 1.6, 1.8, 1.5, 2.0, 2.15, 2.3, 1.0)
# recommended 主循环限尺度（含 ~1742 宽常见档；available 已走快路径）
UPDATE_RECOMMENDED_SCALES = (1.7, 1.6, 1.8, 1.5, 2.0, 2.15, 1.0)
# 防误报：须标题+正文（或标题+Close）共现；0.74 级禁止几何点 ×
UPDATE_TITLE_THRESHOLD = 0.86
UPDATE_BODY_THRESHOLD = 0.84
UPDATE_DUAL_MIN_SCORE = 0.78  # 双模板共现时各自下限
UPDATE_SINGLE_HIGH_SCORE = 0.92  # 仅一侧时须极高分且有 Close/×
UPDATE_CLOSE_THRESHOLD = 0.78
# 快路径：实机 EOL toast 标题曾只到 0.78（旧模板）；新模板应更高，仍留余量
UPDATE_AVAILABLE_TITLE_MIN = 0.78
UPDATE_AVAILABLE_BODY_MIN = 0.78  # EOL/旧正文兜底
UPDATE_AVAILABLE_X_MIN = 0.72  # toast 内 × 模板
# 主循环约每 N 轮主动回收一次（2s×120≈4 分钟）
GC_EVERY_POLLS = 120
# 换号后等待 Connection Error 出现再网络续写（秒）
POST_OPEN_CONN_WAIT = 20
