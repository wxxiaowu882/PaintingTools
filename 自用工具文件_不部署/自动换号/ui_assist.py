# -*- coding: utf-8 -*-
"""Cursor 登录助手：强制置前、只在助手窗口内点刷新/确认。"""
from __future__ import annotations

import time
from typing import Optional, Tuple

from logutil import log
import config
import detect_tip
import win_util


def find_assist_hwnd() -> Optional[Tuple[int, str]]:
    hits = win_util.find_hwnds_by_title(config.ASSIST_TITLE, visible_only=False)
    if not hits:
        return None
    return hits[0]


def focus_assist() -> bool:
    hits = win_util.find_hwnds_by_title(config.ASSIST_TITLE, visible_only=False)
    if not hits:
        log("助手 前置窗口 结果=失败 原因=未找到")
        names = []
        for hwnd, title in win_util.enum_top_windows():
            if title and ("Cursor" in title or "登录" in title):
                names.append(title[:60])
        if names:
            log("助手 候选窗口 " + " | ".join(names[:12]))
        return False

    log(f"助手 找到窗口数={len(hits)}")
    if len(hits) > 1:
        log("警告 发现多个登录助手窗口 请只保留一个 否则可能重复刷新换号")
    for hwnd, title in hits:
        _log_assist_state(hwnd, title, "助手 尝试置前")
        win_util.force_foreground(hwnd)
        time.sleep(0.6)
        _log_assist_state(hwnd, title, "助手 置前后")
        if win_util.is_onscreen(hwnd):
            log("助手 前置窗口 结果=成功")
            return True

    log("助手 前置窗口 结果=失败 原因=未能还原到屏幕上")
    return False


def _log_assist_state(hwnd: int, title: str, prefix: str = "助手") -> None:
    rect = win_util.get_rect(hwnd) or (0, 0, 0, 0)
    log(
        f"{prefix} 窗口 标题={title} hwnd={hwnd} "
        f"最小化={'是' if win_util.is_iconic(hwnd) else '否'} "
        f"可见={'是' if win_util.is_visible(hwnd) else '否'} "
        f"矩形={rect[0]},{rect[1]}-{rect[2]},{rect[3]}"
    )


def _assist_rect_padded(pad: int = 40) -> Optional[Tuple[int, int, int, int]]:
    found = find_assist_hwnd()
    if not found:
        return None
    hwnd, _ = found
    rect = win_util.get_rect(hwnd)
    if not rect:
        return None
    l, t, r, b = rect
    return l - pad, t - pad, r + pad, b + pad


def _click_button_in_hwnd(hwnd: int, names: tuple[str, ...]) -> bool:
    """只在指定顶层窗里找按钮，点矩形中心（不靠 click_input）。"""
    try:
        from pywinauto import Desktop

        win = Desktop(backend="uia").window(handle=hwnd)
        if not win.exists(timeout=1.0):
            return False
        for name in names:
            for ctrl in win.descendants(control_type="Button"):
                try:
                    t = (ctrl.window_text() or "").strip()
                except Exception:
                    continue
                if name not in t and t != name:
                    continue
                try:
                    rr = ctrl.rectangle()
                    cx = (rr.left + rr.right) // 2
                    cy = (rr.top + rr.bottom) // 2
                    if cx <= 0 or cy <= 0:
                        continue
                    detect_tip._click_screen(cx, cy)
                    return True
                except Exception:
                    try:
                        ctrl.invoke()
                        return True
                    except Exception:
                        continue
    except Exception:
        return False
    return False


def click_refresh_cursor() -> bool:
    if not focus_assist():
        return False
    found = find_assist_hwnd()
    if found is None:
        log("点击 刷新Cursor 结果=失败 原因=窗口丢失")
        return False
    hwnd, _title = found

    if _click_button_in_hwnd(hwnd, ("刷新 Cursor", "刷新Cursor")):
        log("点击 刷新Cursor 结果=成功 方式=控件")
        return True

    rect = _assist_rect_padded(8)
    if rect:
        for name in ("btn_refresh_cursor_text.png", "btn_refresh_cursor.png"):
            if detect_tip.click_template_in_abs_rect(name, rect, threshold=0.72):
                log("点击 刷新Cursor 结果=成功 方式=窗口内模板")
                return True

    log("点击 刷新Cursor 结果=失败")
    return False


def wait_and_confirm_switch(timeout: Optional[float] = None) -> str:
    timeout = timeout if timeout is not None else config.CONFIRM_WAIT_SECONDS
    deadline = time.time() + timeout
    time.sleep(0.5)
    while time.time() < deadline:
        # 确认框常是助手的子对话框：再置前一次助手
        found = find_assist_hwnd()
        if found:
            win_util.force_foreground(found[0])

        # 独立标题的确认窗
        for hwnd, title in win_util.find_hwnds_by_title("确认换号", visible_only=False):
            win_util.force_foreground(hwnd)
            if _click_button_in_hwnd(hwnd, ("确认换号",)):
                log("对话框 确认换号 结果=已点击 方式=独立窗口控件")
                return "已点击"

        if found and _click_button_in_hwnd(found[0], ("确认换号",)):
            log("对话框 确认换号 结果=已点击 方式=助手内控件")
            return "已点击"

        rect = _assist_rect_padded(80)
        if rect and detect_tip.click_template_in_abs_rect(
            "btn_confirm_switch.png", rect, threshold=0.72
        ):
            log("对话框 确认换号 结果=已点击 方式=窗口内模板")
            return "已点击"

        time.sleep(0.4)

    log("对话框 确认换号 结果=跳过")
    return "跳过"


def refresh_and_confirm() -> bool:
    if not click_refresh_cursor():
        return False
    wait_and_confirm_switch()
    return True


def refresh_confirm_retry_once() -> bool:
    log("换号 重试 再次点击刷新Cursor")
    if not click_refresh_cursor():
        return False
    wait_and_confirm_switch(timeout=max(config.CONFIRM_WAIT_SECONDS, 25))
    return True
