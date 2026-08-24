# -*- coding: utf-8 -*-
"""Win32：找窗口、强制置前（绕过 SetForegroundWindow 限制）。"""
from __future__ import annotations

import ctypes
from ctypes import wintypes
from typing import List, Optional, Tuple

user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32

SW_RESTORE = 9
SW_SHOW = 5
SW_MAXIMIZE = 3
HWND_TOPMOST = -1
HWND_NOTOPMOST = -2
SWP_NOSIZE = 0x0001
SWP_NOMOVE = 0x0002
SWP_SHOWWINDOW = 0x0040

WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)


def set_dpi_aware() -> None:
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except Exception:
        try:
            user32.SetProcessDPIAware()
        except Exception:
            pass


def _window_text(hwnd: int) -> str:
    n = user32.GetWindowTextLengthW(hwnd)
    if n <= 0:
        return ""
    buf = ctypes.create_unicode_buffer(n + 1)
    user32.GetWindowTextW(hwnd, buf, n + 1)
    return buf.value or ""


def is_visible(hwnd: int) -> bool:
    return bool(user32.IsWindowVisible(hwnd))


def is_iconic(hwnd: int) -> bool:
    return bool(user32.IsIconic(hwnd))


def is_onscreen(hwnd: int) -> bool:
    rect = get_rect(hwnd)
    if not rect:
        return False
    l, t, r, b = rect
    return l > -400 and t > -400 and (r - l) > 120 and (b - t) > 80 and not is_iconic(hwnd)


def get_rect(hwnd: int) -> Optional[Tuple[int, int, int, int]]:
    rect = wintypes.RECT()
    if not user32.GetWindowRect(hwnd, ctypes.byref(rect)):
        return None
    return int(rect.left), int(rect.top), int(rect.right), int(rect.bottom)


def enum_top_windows() -> List[Tuple[int, str]]:
    found: List[Tuple[int, str]] = []

    def _cb(hwnd, _lparam):
        title = _window_text(hwnd)
        found.append((int(hwnd), title))
        return True

    cb = WNDENUMPROC(_cb)
    user32.EnumWindows(cb, 0)
    return found


def _window_rank(hwnd: int) -> int:
    """越大越该用：在屏且未最小化 > 最小化可还原 > 隐藏。"""
    rect = get_rect(hwnd)
    if not rect:
        return -1
    l, t, r, b = rect
    w, h = r - l, b - t
    onscreen = l > -400 and t > -400 and w > 120 and h > 80
    if onscreen:
        score = 20_000_000 + w * h
        if is_visible(hwnd) and not is_iconic(hwnd):
            score += 5_000_000
        return score
    if is_iconic(hwnd):
        return 1_000_000
    return 10


def find_hwnds_by_title(substr: str, visible_only: bool = False) -> List[Tuple[int, str]]:
    hits = []
    for hwnd, title in enum_top_windows():
        if substr and substr in title:
            if visible_only and not is_visible(hwnd):
                continue
            hits.append((hwnd, title))
    hits.sort(key=lambda it: _window_rank(it[0]), reverse=True)
    return hits


def is_zoomed(hwnd: int) -> bool:
    return bool(user32.IsZoomed(hwnd))


def force_foreground(hwnd: int) -> bool:
    """
    置前。仅在最小化时还原，避免把已最大化窗口 SW_RESTORE 回去。
    """
    if not hwnd or not user32.IsWindow(hwnd):
        return False
    try:
        if is_iconic(hwnd):
            user32.ShowWindow(hwnd, SW_RESTORE)
        user32.ShowWindow(hwnd, SW_SHOW)
        # 模拟一下 Alt，放松 Windows 对前台切换的限制
        user32.keybd_event(0x12, 0, 0, 0)
        user32.keybd_event(0x12, 0, 2, 0)
        fg = user32.GetForegroundWindow()
        cur_tid = kernel32.GetCurrentThreadId()
        fg_pid = wintypes.DWORD()
        self_pid = wintypes.DWORD()
        fg_tid = user32.GetWindowThreadProcessId(fg, ctypes.byref(fg_pid))
        self_tid = user32.GetWindowThreadProcessId(hwnd, ctypes.byref(self_pid))
        if fg_tid and fg_tid != cur_tid:
            user32.AttachThreadInput(cur_tid, fg_tid, True)
        if self_tid and self_tid != cur_tid:
            user32.AttachThreadInput(cur_tid, self_tid, True)
        user32.BringWindowToTop(hwnd)
        user32.SetForegroundWindow(hwnd)
        user32.SetWindowPos(
            hwnd,
            HWND_TOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
        )
        user32.SetWindowPos(
            hwnd,
            HWND_NOTOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
        )
        if self_tid and self_tid != cur_tid:
            user32.AttachThreadInput(cur_tid, self_tid, False)
        if fg_tid and fg_tid != cur_tid:
            user32.AttachThreadInput(cur_tid, fg_tid, False)
        return user32.GetForegroundWindow() == hwnd or not is_iconic(hwnd)
    except Exception:
        return False


WM_SYSCOMMAND = 0x0112
SC_MAXIMIZE = 0xF030


def maximize(hwnd: int) -> bool:
    if not hwnd or not user32.IsWindow(hwnd):
        return False
    try:
        if is_iconic(hwnd):
            user32.ShowWindow(hwnd, SW_RESTORE)
        user32.ShowWindow(hwnd, SW_MAXIMIZE)
        user32.SendMessageW(hwnd, WM_SYSCOMMAND, SC_MAXIMIZE, 0)
        return bool(is_zoomed(hwnd))
    except Exception:
        return False


def bring_and_maximize(hwnd: int) -> bool:
    force_foreground(hwnd)
    maximize(hwnd)
    force_foreground(hwnd)
    return bool(is_zoomed(hwnd))
