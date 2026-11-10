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
SW_MINIMIZE = 6
SW_FORCEMINIMIZE = 11
SW_SHOWMINIMIZED = 2
HWND_TOPMOST = -1
HWND_NOTOPMOST = -2
HWND_TOP = 0
SWP_NOSIZE = 0x0001
SWP_NOMOVE = 0x0002
SWP_SHOWWINDOW = 0x0040
SWP_NOACTIVATE = 0x0010
GA_ROOT = 2
WM_SYSCOMMAND = 0x0112
SC_MINIMIZE = 0xF020
SC_RESTORE = 0xF120
SC_MAXIMIZE = 0xF030

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


class WINDOWPLACEMENT(ctypes.Structure):
    _fields_ = [
        ("length", ctypes.c_uint),
        ("flags", ctypes.c_uint),
        ("showCmd", ctypes.c_uint),
        ("ptMinPosition", wintypes.POINT),
        ("ptMaxPosition", wintypes.POINT),
        ("rcNormalPosition", wintypes.RECT),
    ]


def restore_window_onscreen(hwnd: int) -> bool:
    """
    把最小化/托盘隐藏（-25600）的窗口拉回屏幕。
    优先 ShowWindow(SW_RESTORE)；仍屏外则用 GetWindowPlacement 的正常矩形。
    """
    if not hwnd or not user32.IsWindow(hwnd):
        return False
    try:
        if is_iconic(hwnd) or not is_onscreen(hwnd):
            user32.ShowWindow(hwnd, SW_RESTORE)
            user32.ShowWindow(hwnd, SW_SHOW)
        if is_onscreen(hwnd):
            return True
        place = WINDOWPLACEMENT()
        place.length = ctypes.sizeof(WINDOWPLACEMENT)
        if user32.GetWindowPlacement(hwnd, ctypes.byref(place)):
            rc = place.rcNormalPosition
            w = max(200, int(rc.right - rc.left))
            h = max(160, int(rc.bottom - rc.top))
            x = int(rc.left)
            y = int(rc.top)
            # 正常矩形也可能是屏外占位，落到主屏左上附近
            if x < -200 or y < -200 or x > 8000 or y > 5000:
                x, y = 80, 60
            user32.SetWindowPos(
                hwnd,
                HWND_TOPMOST,
                x,
                y,
                w,
                h,
                SWP_SHOWWINDOW,
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
            user32.ShowWindow(hwnd, SW_SHOW)
        return is_onscreen(hwnd)
    except Exception:
        return False


def restore_window_hard(hwnd: int) -> bool:
    """
    换号后硬还原 Cursor：Electron 最小化后仅 SW_RESTORE 常仍 iconic/屏外，
    会导致「已还原」但置前工程窗找不到。
    """
    if not hwnd or not user32.IsWindow(hwnd):
        return False
    hwnd = get_root_hwnd(hwnd)
    import time as _t

    for _attempt in range(3):
        try:
            user32.PostMessageW(hwnd, WM_SYSCOMMAND, SC_RESTORE, 0)
        except Exception:
            pass
        try:
            user32.SendMessageW(hwnd, WM_SYSCOMMAND, SC_RESTORE, 0)
        except Exception:
            pass
        user32.ShowWindow(hwnd, SW_RESTORE)
        user32.ShowWindow(hwnd, SW_SHOW)
        restore_window_onscreen(hwnd)
        try:
            maximize(hwnd)
        except Exception:
            pass
        force_foreground(hwnd, keep_topmost=True)
        set_topmost(hwnd, True)
        _t.sleep(0.2)
        if is_onscreen(hwnd) and not is_iconic(hwnd):
            set_topmost(hwnd, False)
            return True
        _t.sleep(0.25)
    # 最后再清置顶，避免 Cursor 一直顶着
    set_topmost(hwnd, False)
    return is_onscreen(hwnd) and not is_iconic(hwnd)


def is_foreground(hwnd: int) -> bool:
    if not hwnd:
        return False
    try:
        return int(user32.GetForegroundWindow()) == int(hwnd)
    except Exception:
        return False


def set_topmost(hwnd: int, on: bool) -> None:
    """置顶 / 取消置顶。换号点管家时需 keep 置顶，否则 Cursor 抢前台后只闪任务栏。"""
    if not hwnd or not user32.IsWindow(hwnd):
        return
    try:
        user32.SetWindowPos(
            hwnd,
            HWND_TOPMOST if on else HWND_NOTOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
        )
        if on:
            # 再抬一次 Z 序，避免仅 TOPMOST 标志、仍被同层盖住
            user32.SetWindowPos(
                hwnd,
                HWND_TOP,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
            )
            user32.SetWindowPos(
                hwnd,
                HWND_TOPMOST,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
            )
    except Exception:
        pass


def get_root_hwnd(hwnd: int) -> int:
    """子控件 → 顶层窗；Electron 前台句柄常是子窗，最小化必须打根窗。"""
    if not hwnd:
        return 0
    try:
        root = int(user32.GetAncestor(int(hwnd), GA_ROOT) or 0)
        return root or int(hwnd)
    except Exception:
        return int(hwnd)


def minimize(hwnd: int) -> bool:
    """
    强力最小化。Cursor/Electron 上仅 ShowWindow(SW_MINIMIZE) 后 IsIconic
    常仍为假，旧逻辑会误判失败 → 日志「最小化Cursor=否」。
    """
    if not hwnd or not user32.IsWindow(hwnd):
        return False
    hwnd = get_root_hwnd(hwnd)
    if not hwnd or not user32.IsWindow(hwnd):
        return False
    try:
        # 多招并行：SysCommand + ForceMinimize + Minimize
        try:
            user32.PostMessageW(hwnd, WM_SYSCOMMAND, SC_MINIMIZE, 0)
        except Exception:
            pass
        try:
            user32.SendMessageW(hwnd, WM_SYSCOMMAND, SC_MINIMIZE, 0)
        except Exception:
            pass
        user32.ShowWindow(hwnd, SW_FORCEMINIMIZE)
        user32.ShowWindow(hwnd, SW_MINIMIZE)
        user32.ShowWindow(hwnd, SW_SHOWMINIMIZED)
        # 给 Electron 一拍刷新 iconic 状态
        import time as _t

        _t.sleep(0.12)
        if is_iconic(hwnd):
            return True
        # 仍不 iconic：再试一次 ForceMinimize（部分高 DPI 窗第一次吞掉）
        user32.ShowWindow(hwnd, SW_FORCEMINIMIZE)
        _t.sleep(0.12)
        if is_iconic(hwnd):
            return True
        # 最后手段：挪到屏外（视觉上让开），还原时靠 restore_window_onscreen
        rect = get_rect(hwnd)
        if rect:
            l, t, r, b = rect
            w, h = max(200, r - l), max(160, b - t)
            user32.SetWindowPos(
                hwnd,
                HWND_NOTOPMOST,
                -32000,
                -32000,
                w,
                h,
                SWP_SHOWWINDOW | SWP_NOACTIVATE,
            )
            _t.sleep(0.08)
            nr = get_rect(hwnd)
            if nr and nr[0] < -1000:
                return True
        return bool(is_iconic(hwnd))
    except Exception:
        return False


def force_foreground(hwnd: int, keep_topmost: bool = False) -> bool:
    """
    置前。最小化或托盘/屏外（坐标约 -25600）时先还原，
    避免把已在屏上最大化的窗口 SW_RESTORE 回去。
    keep_topmost=True：置顶后不立刻取消（管家换号用，防 Cursor 压住只闪任务栏）。
    """
    if not hwnd or not user32.IsWindow(hwnd):
        return False
    try:
        if is_iconic(hwnd) or not is_onscreen(hwnd):
            restore_window_onscreen(hwnd)
        user32.ShowWindow(hwnd, SW_SHOW)
        # 模拟一下 Alt，放松 Windows 对前台切换的限制
        user32.keybd_event(0x12, 0, 0, 0)
        user32.keybd_event(0x12, 0, 2, 0)
        try:
            # 当前进程若有前台权，放宽其它进程置前
            user32.AllowSetForegroundWindow(-1)
        except Exception:
            pass
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
        try:
            # 部分环境比 SetForegroundWindow 更有效
            user32.SwitchToThisWindow(hwnd, True)
        except Exception:
            pass
        user32.SetForegroundWindow(hwnd)
        set_topmost(hwnd, True)
        if not keep_topmost:
            set_topmost(hwnd, False)
        if self_tid and self_tid != cur_tid:
            user32.AttachThreadInput(cur_tid, self_tid, False)
        if fg_tid and fg_tid != cur_tid:
            user32.AttachThreadInput(cur_tid, fg_tid, False)
        visible_ok = is_onscreen(hwnd) and not is_iconic(hwnd)
        fg_ok = is_foreground(hwnd)
        if keep_topmost:
            # 抢前台失败时仍可靠置顶露脸，供截图/点击
            return visible_ok
        return fg_ok or visible_ok
    except Exception:
        return False


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


class _MONITORINFO(ctypes.Structure):
    _fields_ = [
        ("cbSize", wintypes.DWORD),
        ("rcMonitor", wintypes.RECT),
        ("rcWork", wintypes.RECT),
        ("dwFlags", wintypes.DWORD),
    ]


MONITOR_DEFAULTTONEAREST = 2


def get_monitor_work_area(hwnd: int) -> Optional[Tuple[int, int, int, int]]:
    """返回窗所在显示器工作区 (left, top, right, bottom)。"""
    if not hwnd or not user32.IsWindow(hwnd):
        return None
    try:
        hmon = user32.MonitorFromWindow(int(hwnd), MONITOR_DEFAULTTONEAREST)
        mi = _MONITORINFO()
        mi.cbSize = ctypes.sizeof(_MONITORINFO)
        if not user32.GetMonitorInfoW(hmon, ctypes.byref(mi)):
            return None
        return (
            int(mi.rcWork.left),
            int(mi.rcWork.top),
            int(mi.rcWork.right),
            int(mi.rcWork.bottom),
        )
    except Exception:
        return None


def is_covering_work_area(hwnd: int, min_ratio: float = 0.94) -> bool:
    """
    是否已「视觉全屏」：相对所在显示器工作区宽高均达到 min_ratio。
    禁止用固定像素（曾把 1650x1044 误判为铺满）。
    """
    if not hwnd or is_iconic(hwnd):
        return False
    if is_zoomed(hwnd) and is_onscreen(hwnd):
        return True
    work = get_monitor_work_area(hwnd)
    rect = get_rect(hwnd)
    if not work or not rect:
        return False
    wl, wt, wr, wb = work
    ww, wh = max(1, wr - wl), max(1, wb - wt)
    l, t, r, b = rect
    rw, rh = r - l, b - t
    return (
        rw >= int(ww * min_ratio)
        and rh >= int(wh * min_ratio)
        and abs(l - wl) <= 40
        and abs(t - wt) <= 40
    )


def fill_monitor_work_area(hwnd: int) -> bool:
    """
    Electron 常拒绝 IsZoomed：用 SetWindowPos 硬铺满工作区。
    注意：铺满后不要再盲目 SW_MAXIMIZE（失败时可能弹回窗口态）。
    """
    import time as time_mod

    if not hwnd or not user32.IsWindow(hwnd):
        return False
    hwnd = get_root_hwnd(hwnd)
    work = get_monitor_work_area(hwnd)
    if not work:
        return False
    l, t, r, b = work
    ww, wh = max(400, r - l), max(300, b - t)
    try:
        if is_iconic(hwnd):
            user32.ShowWindow(hwnd, SW_SHOW)
            time_mod.sleep(0.08)
        # 先试系统最大化
        user32.ShowWindow(hwnd, SW_MAXIMIZE)
        user32.SendMessageW(hwnd, WM_SYSCOMMAND, SC_MAXIMIZE, 0)
        time_mod.sleep(0.12)
        if is_covering_work_area(hwnd):
            return True
        # 硬铺满：置顶 + 精确工作区尺寸（不做随后的 SW_MAXIMIZE，防弹回）
        set_topmost(hwnd, True)
        user32.SetWindowPos(
            hwnd,
            HWND_TOPMOST,
            l,
            t,
            ww,
            wh,
            SWP_SHOWWINDOW,
        )
        time_mod.sleep(0.1)
        set_topmost(hwnd, False)
        user32.SetWindowPos(
            hwnd,
            HWND_TOP,
            l,
            t,
            ww,
            wh,
            SWP_SHOWWINDOW,
        )
        time_mod.sleep(0.12)
        # 再尝试一次系统最大化（部分 Electron 在铺满后再 Max 会成功）
        user32.ShowWindow(hwnd, SW_MAXIMIZE)
        time_mod.sleep(0.1)
        if is_covering_work_area(hwnd):
            return True
        # 若 Max 弹回窗口态：再硬铺一次并保持，不再调 Max
        set_topmost(hwnd, True)
        user32.SetWindowPos(
            hwnd,
            HWND_TOPMOST,
            l,
            t,
            ww,
            wh,
            SWP_SHOWWINDOW,
        )
        time_mod.sleep(0.1)
        set_topmost(hwnd, False)
        return is_covering_work_area(hwnd, min_ratio=0.90)
    except Exception:
        return False


def maximize_or_fill(hwnd: int) -> bool:
    """系统最大化或硬铺满工作区。"""
    if is_covering_work_area(hwnd):
        return True
    if maximize(hwnd) and is_covering_work_area(hwnd):
        return True
    return fill_monitor_work_area(hwnd)


def bring_and_maximize(hwnd: int) -> bool:
    force_foreground(hwnd)
    ok = maximize_or_fill(hwnd)
    force_foreground(hwnd)
    return bool(ok)


def maximize_via_ahk(hwnd: int, timeout: float = 6.0) -> bool:
    """AHK 最大化；失败仍可用 fill_monitor_work_area。"""
    import subprocess
    import time as time_mod
    from pathlib import Path

    if not hwnd or not user32.IsWindow(int(hwnd)):
        return False
    found = find_autohotkey()
    if not found:
        return maximize_or_fill(hwnd)
    exe, ver = found
    script = _ahk_dir() / ("maximize_window_v2.ahk" if ver == 2 else "maximize_window_v2.ahk")
    if not Path(script).is_file():
        return maximize_or_fill(hwnd)
    try:
        subprocess.run(
            [exe, str(script), str(int(hwnd))],
            capture_output=True,
            text=True,
            timeout=timeout,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except Exception:
        pass
    time_mod.sleep(0.2)
    if is_covering_work_area(int(hwnd)):
        return True
    return fill_monitor_work_area(int(hwnd))


def _ahk_dir() -> "Path":
    from pathlib import Path

    return Path(__file__).resolve().parent / "ahk"


def find_autohotkey() -> Optional[Tuple[str, int]]:
    """
    查找本机 AutoHotkey。返回 (exe路径, 主版本1|2)；未找到返回 None。
    抢前台比纯 SetForegroundWindow 稳，换号切回 Cursor 优先走这条。
    """
    import os
    from pathlib import Path

    # 先查固定安装路径（优先），避免 PATH 里 WindowsApps 空壳
    candidates_v2 = [
        os.path.expandvars(r"%ProgramFiles%\AutoHotkey\v2\AutoHotkey64.exe"),
        os.path.expandvars(r"%ProgramFiles%\AutoHotkey\v2\AutoHotkey.exe"),
        os.path.expandvars(r"%ProgramFiles%\AutoHotkey\v2\AutoHotkey32.exe"),
        os.path.expandvars(r"%LocalAppData%\Programs\AutoHotkey\v2\AutoHotkey64.exe"),
        r"C:\Program Files\AutoHotkey\v2\AutoHotkey64.exe",
    ]
    candidates_v1 = [
        os.path.expandvars(r"%ProgramFiles%\AutoHotkey\AutoHotkey.exe"),
        os.path.expandvars(r"%ProgramFiles%\AutoHotkey\AutoHotkeyU64.exe"),
        os.path.expandvars(r"%LocalAppData%\Programs\AutoHotkey\AutoHotkey.exe"),
        r"C:\Program Files\AutoHotkey\AutoHotkey.exe",
        r"C:\Program Files\AutoHotkey\AutoHotkeyU64.exe",
    ]
    for p in candidates_v2:
        if Path(p).is_file():
            return p, 2
    for p in candidates_v1:
        if Path(p).is_file():
            return p, 1
    for name in ("AutoHotkey64.exe", "AutoHotkey.exe", "autohotkey.exe"):
        for folder in os.environ.get("PATH", "").split(os.pathsep):
            if "windowsapps" in folder.lower():
                continue
            p = Path(folder) / name
            if p.is_file():
                pl = str(p).lower()
                ver = 2 if "\\v2\\" in pl else 1
                return str(p), ver
    return None


def activate_via_ahk(
    target_hwnd: int,
    minimize_hwnd: Optional[int] = None,
    timeout: float = 8.0,
) -> bool:
    """
    用 AutoHotkey WinActivate 抢前台（可顺带最小化管家）。
    成功条件：目标成为前台，或至少在屏且非最小化。
    """
    import subprocess
    import time as time_mod
    from pathlib import Path

    if not target_hwnd or not user32.IsWindow(int(target_hwnd)):
        return False
    found = find_autohotkey()
    if not found:
        return False
    exe, ver = found
    script = _ahk_dir() / ("activate_window_v2.ahk" if ver == 2 else "activate_window.ahk")
    if not script.is_file():
        # 版本与脚本不匹配时互备
        alt = _ahk_dir() / ("activate_window.ahk" if ver == 2 else "activate_window_v2.ahk")
        if alt.is_file():
            script = alt
        else:
            return False

    args = [exe, str(script), str(int(target_hwnd))]
    if minimize_hwnd and user32.IsWindow(int(minimize_hwnd)):
        args.append(str(int(minimize_hwnd)))
    try:
        r = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=timeout,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except Exception:
        return False
    time_mod.sleep(0.2)
    # 必须以前台为准；仅「在屏」会误报成功（管家在 Cursor 后面最大化）
    ok_fg = is_foreground(int(target_hwnd))
    if ok_fg:
        return True
    # AHK 退出码 0 但前台仍被占：再验一次（偶发延迟）
    time_mod.sleep(0.25)
    return bool(is_foreground(int(target_hwnd)))


MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
MOUSEEVENTF_ABSOLUTE = 0x8000
MOUSEEVENTF_MOVE = 0x0001
WM_LBUTTONDOWN = 0x0201
WM_LBUTTONUP = 0x0202
MK_LBUTTON = 0x0001


def click_screen_hard(x: int, y: int, hwnd: Optional[int] = None) -> None:
    """
    硬点击：SetCursorPos + mouse_event，再对落点/指定窗 PostMessage。
    WebView 常吃掉普通 pyautogui.click，管家无感换号必须走这条。
    """
    import time as time_mod

    sx, sy = int(x), int(y)
    # 先置前目标窗，避免点到别的层
    if hwnd:
        try:
            force_foreground(int(hwnd))
            time_mod.sleep(0.08)
        except Exception:
            pass
    user32.SetCursorPos(sx, sy)
    time_mod.sleep(0.06)
    user32.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
    time_mod.sleep(0.05)
    user32.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
    # PostMessage 到落点子窗 + 顶层 hwnd（双保险）
    targets = []
    try:
        # 64 位 WindowFromPoint 吃一个 LONG 打包的 POINT
        packed = (sy << 32) | (sx & 0xFFFFFFFF)
        try:
            target = user32.WindowFromPoint(packed)
        except Exception:
            pt = wintypes.POINT(sx, sy)
            user32.WindowFromPoint.argtypes = [wintypes.POINT]
            user32.WindowFromPoint.restype = wintypes.HWND
            target = user32.WindowFromPoint(pt)
        if target:
            targets.append(int(target))
    except Exception:
        pass
    if hwnd and int(hwnd) not in targets:
        targets.append(int(hwnd))
    for target in targets:
        try:
            client = wintypes.POINT(sx, sy)
            user32.ScreenToClient(target, ctypes.byref(client))
            lp = (int(client.y) << 16) | (int(client.x) & 0xFFFF)
            user32.PostMessageW(target, WM_LBUTTONDOWN, MK_LBUTTON, lp)
            time_mod.sleep(0.03)
            user32.PostMessageW(target, WM_LBUTTONUP, 0, lp)
        except Exception:
            continue
