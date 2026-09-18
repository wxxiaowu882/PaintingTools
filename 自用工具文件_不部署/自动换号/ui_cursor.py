# -*- coding: utf-8 -*-
"""Cursor：保存、等重启、Editor Window、打开工程。"""
from __future__ import annotations

import os
import subprocess
import time
from typing import Optional

import config
import detect_tip
import win_util
from logutil import log


def find_cursor_hwnds():
    """标题含 Cursor、排除登录助手。"""
    found = []
    for hwnd, title in win_util.find_hwnds_by_title(config.CURSOR_TITLE, visible_only=False):
        if config.ASSIST_TITLE in title:
            continue
        if "登录助手" in title:
            continue
        found.append((hwnd, title))
    return found


def find_cursor_windows():
    """兼容旧调用：尽量返回 pywinauto 包装，失败则空列表。"""
    hwnds = find_cursor_hwnds()
    if not hwnds:
        return []
    try:
        from pywinauto import Desktop

        desk = Desktop(backend="uia")
        wins = []
        for hwnd, _title in hwnds:
            try:
                wins.append(desk.window(handle=hwnd))
            except Exception:
                continue
        return wins
    except Exception as e:
        log(f"错误 包装Cursor窗口 {e}")
        return []


def focus_cursor() -> bool:
    hwnds = find_cursor_hwnds()
    if not hwnds:
        return False
    hwnd, _title = hwnds[0]
    return win_util.force_foreground(hwnd)


def dismiss_external_site_dialog(timeout: float = 4.0) -> str:
    """
    关掉「是否要 Cursor 打开外部网站？」弹窗（点「取消」）。
    换号重启后偶发，不关会挡住 Editor Window / 续写。
    优先模板匹配（Electron 对话框 UIA 常扫不到），再 UIA，再 Esc。
    """
    deadline = time.time() + timeout
    hints = (
        "打开外部网站",
        "受信任的域",
        "apps.apple.com",
        "open an external website",
        "trusted domains",
    )

    def _click_cancel_by_template() -> bool:
        screen, mon_l, mon_t = detect_tip.grab_screen_bgr()
        h, w = screen.shape[:2]
        # 对话框在屏幕中部
        x0, y0 = int(w * 0.15), int(h * 0.15)
        x1, y1 = int(w * 0.85), int(h * 0.85)
        roi = screen[y0:y1, x0:x1]

        tpl_cancel = detect_tip._load_template("btn_cancel_external.png")
        tpl_dlg = detect_tip._load_template("dlg_open_external.png")
        hit_c = detect_tip._match_scaled(roi, tpl_cancel, 0.78)
        hit_d = detect_tip._match_scaled(roi, tpl_dlg, 0.72)

        if hit_c is not None:
            score, lx, ly, tw, th = hit_c
            # 需对话框文案共现，或取消模板极高分
            if hit_d is not None or score >= 0.90:
                cx = mon_l + x0 + lx + tw // 2
                cy = mon_t + y0 + ly + th // 2
                detect_tip._click_screen(cx, cy)
                log(
                    f"对话框 打开外部网站 结果=已取消 方式=取消模板 "
                    f"分数={score:.2f} 坐标={cx},{cy}"
                )
                time.sleep(0.45)
                return True

        if hit_d is not None:
            score, lx, ly, tw, th = hit_d
            # 文案在中上部；取消约在其右下方
            if hit_c is not None:
                sc, clx, cly, ctw, cth = hit_c
                cx = mon_l + x0 + clx + ctw // 2
                cy = mon_t + y0 + cly + cth // 2
                score = max(score, sc)
            else:
                cx = mon_l + x0 + lx + tw - 30
                cy = mon_t + y0 + ly + th + 55
            detect_tip._click_screen(int(cx), int(cy))
            log(
                f"对话框 打开外部网站 结果=已取消 方式=文案定位 "
                f"分数={score:.2f} 坐标={cx},{cy}"
            )
            time.sleep(0.45)
            return True
        return False

    while time.time() < deadline:
        try:
            if _click_cancel_by_template():
                return "已取消"
        except Exception as e:
            log(f"对话框 打开外部网站 模板异常 {e}")

        try:
            from pywinauto import Desktop

            desk = Desktop(backend="uia")
            candidates = []
            for win in desk.windows():
                try:
                    title = (win.window_text() or "").strip()
                except Exception:
                    continue
                if config.ASSIST_TITLE in title or "登录助手" in title:
                    continue
                if title != "Cursor" and not title.startswith("Cursor"):
                    continue
                try:
                    rect = win.rectangle()
                    w = int(rect.right - rect.left)
                    h = int(rect.bottom - rect.top)
                except Exception:
                    continue
                if w < 260 or h < 100:
                    continue
                candidates.append((w * h, win, title))

            candidates.sort(key=lambda it: it[0])
            for _area, win, title in candidates:
                try:
                    texts = []
                    buttons = []
                    try:
                        for ctrl in win.descendants(control_type="Button"):
                            buttons.append(ctrl)
                            t = (ctrl.window_text() or "").strip()
                            if t:
                                texts.append(t)
                    except Exception:
                        pass
                    try:
                        for ctrl in win.descendants(control_type="Text"):
                            t = (ctrl.window_text() or "").strip()
                            if t:
                                texts.append(t)
                    except Exception:
                        pass
                    blob = "\n".join(texts)
                    has_hint = any(h in blob for h in hints)
                    has_open = any("打开" in t for t in texts)
                    has_cancel = any(t == "取消" or t.startswith("取消") for t in texts)
                    has_copy = any("复制" in t for t in texts)
                    if not has_hint and not (
                        title == "Cursor"
                        and has_open
                        and has_cancel
                        and has_copy
                        and _area < 500_000
                    ):
                        continue

                    for ctrl in buttons:
                        try:
                            t = (ctrl.window_text() or "").strip()
                        except Exception:
                            continue
                        if t != "取消" and not t.startswith("取消"):
                            continue
                        try:
                            rr = ctrl.rectangle()
                            cx = (rr.left + rr.right) // 2
                            cy = (rr.top + rr.bottom) // 2
                            if cx > 0 and cy > 0:
                                detect_tip._click_screen(cx, cy)
                                log(
                                    f"对话框 打开外部网站 结果=已取消 "
                                    f"方式=控件 坐标={cx},{cy}"
                                )
                                time.sleep(0.5)
                                return "已取消"
                        except Exception:
                            try:
                                ctrl.invoke()
                                log("对话框 打开外部网站 结果=已取消 方式=invoke")
                                time.sleep(0.5)
                                return "已取消"
                            except Exception:
                                continue
                    try:
                        import pyautogui

                        win_util.force_foreground(int(win.handle))
                        pyautogui.FAILSAFE = False
                        pyautogui.press("esc")
                        log("对话框 打开外部网站 结果=已取消 方式=Esc")
                        time.sleep(0.5)
                        return "已取消"
                    except Exception as e:
                        log(f"对话框 打开外部网站 结果=失败 原因={e}")
                except Exception:
                    continue
        except Exception as e:
            log(f"对话框 打开外部网站 扫描异常 {e}")

        # 模板已检出对话框但上面没点成：Esc 兜底
        try:
            dlg = detect_tip.match_template_on_screen(
                "dlg_open_external.png", threshold=0.72
            )
            if dlg is not None:
                import pyautogui

                pyautogui.FAILSAFE = False
                pyautogui.press("esc")
                log("对话框 打开外部网站 结果=已取消 方式=Esc模板兜底")
                time.sleep(0.5)
                return "已取消"
        except Exception:
            pass
        time.sleep(0.35)
    return "跳过"


def dismiss_blocking_dialogs(rounds: int = 2) -> None:
    """换号后连续清挡路弹窗（外部网站确认等）。"""
    for _ in range(max(1, rounds)):
        r = dismiss_external_site_dialog(timeout=2.5)
        if r == "跳过":
            break
        time.sleep(0.3)


def find_paintingtools_hwnd(timeout: float = 12.0):
    """
    找标题含 PaintingTools 的 Cursor 工程窗（排除登录助手）。
    CLI 打开后标题可能晚几秒才变成工程名。
    """
    deadline = time.time() + timeout
    last = []
    while time.time() < deadline:
        last = find_cursor_hwnds()
        for hwnd, title in last:
            if "PaintingTools" in title and win_util.is_onscreen(hwnd):
                return hwnd, title
        time.sleep(0.4)
    # 退回：最大的 Cursor 主窗
    found = _largest_cursor_rect()
    if found:
        hwnd, _rect = found
        title = ""
        for h, t in last:
            if h == hwnd:
                title = t
                break
        return hwnd, title or "Cursor"
    return None


def bring_paintingtools_front_max() -> bool:
    """把 PaintingTools 工程窗口置前并最大化，方便后续关 tip / 续写。"""
    found = find_paintingtools_hwnd()
    if not found:
        log("置前工程窗 结果=失败 原因=未找到")
        return False
    hwnd, title = found
    win_util.force_foreground(hwnd)
    time.sleep(0.25)
    zoomed = win_util.maximize(hwnd)
    if not zoomed:
        try:
            import pyautogui

            pyautogui.FAILSAFE = False
            pyautogui.hotkey("win", "up")
            time.sleep(0.35)
            zoomed = win_util.is_zoomed(hwnd)
        except Exception:
            pass
    win_util.force_foreground(hwnd)
    time.sleep(0.35)
    rect = win_util.get_rect(hwnd) or (0, 0, 0, 0)
    w, h = rect[2] - rect[0], rect[3] - rect[1]
    log(
        f"置前工程窗 结果=成功 标题={title} 尺寸={w}x{h} "
        f"最大化={'是' if zoomed else '否'}"
    )
    return True


def _set_clipboard(text: str) -> None:
    """
    剪贴板写入：UTF-8 临时文件 + PowerShell（避开 OpenClipboard 拒绝访问 / 空指针崩溃）。
    """
    clip_path = config.LOGS_DIR / "_clip_tmp.txt"
    config.LOGS_DIR.mkdir(parents=True, exist_ok=True)
    clip_path.write_text(text, encoding="utf-8")
    # .NET 读 UTF-8 再 SetText，比 Get-Content|Set-Clipboard 更稳
    path_lit = str(clip_path).replace("'", "''")
    ps = (
        "Add-Type -AssemblyName System.Windows.Forms; "
        f"$p = '{path_lit}'; "
        "$t = [System.IO.File]::ReadAllText($p, [System.Text.UTF8Encoding]::new($false)); "
        "[System.Windows.Forms.Clipboard]::SetText($t)"
    )
    last_err = ""
    for _ in range(4):
        r = subprocess.run(
            ["powershell", "-NoProfile", "-Command", ps],
            capture_output=True,
            text=True,
            timeout=10,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        if r.returncode == 0:
            return
        last_err = (r.stderr or r.stdout or "").strip()
        time.sleep(0.2)
    raise OSError(f"剪贴板失败 ps={last_err}")


def _type_unicode(text: str) -> None:
    """SendInput Unicode（含 64 位 INPUT 联合体对齐）。"""
    import ctypes
    from ctypes import wintypes

    ULONG_PTR = ctypes.c_size_t

    class MOUSEINPUT(ctypes.Structure):
        _fields_ = [
            ("dx", wintypes.LONG),
            ("dy", wintypes.LONG),
            ("mouseData", wintypes.DWORD),
            ("dwFlags", wintypes.DWORD),
            ("time", wintypes.DWORD),
            ("dwExtraInfo", ULONG_PTR),
        ]

    class KEYBDINPUT(ctypes.Structure):
        _fields_ = [
            ("wVk", wintypes.WORD),
            ("wScan", wintypes.WORD),
            ("dwFlags", wintypes.DWORD),
            ("time", wintypes.DWORD),
            ("dwExtraInfo", ULONG_PTR),
        ]

    class HARDWAREINPUT(ctypes.Structure):
        _fields_ = [
            ("uMsg", wintypes.DWORD),
            ("wParamL", wintypes.WORD),
            ("wParamH", wintypes.WORD),
        ]

    class INPUT(ctypes.Structure):
        class _INPUT(ctypes.Union):
            _fields_ = [("mi", MOUSEINPUT), ("ki", KEYBDINPUT), ("hi", HARDWAREINPUT)]

        _anonymous_ = ("_input",)
        _fields_ = [("type", wintypes.DWORD), ("_input", _INPUT)]

    INPUT_KEYBOARD = 1
    KEYEVENTF_UNICODE = 0x0004
    KEYEVENTF_KEYUP = 0x0002
    SendInput = ctypes.windll.user32.SendInput
    SendInput.argtypes = [wintypes.UINT, ctypes.POINTER(INPUT), ctypes.c_int]
    SendInput.restype = wintypes.UINT
    for ch in text:
        code = ord(ch)
        for flags in (KEYEVENTF_UNICODE, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP):
            inp = INPUT()
            inp.type = INPUT_KEYBOARD
            inp.ki = KEYBDINPUT(0, code, flags, 0, 0)
            if SendInput(1, ctypes.byref(inp), ctypes.sizeof(INPUT)) != 1:
                raise OSError(f"SendInput 失败 code={ctypes.get_last_error()}")


def send_continue_in_chat(prompt: Optional[str] = None) -> bool:
    """
    底部 chat 输入框：点进去，输入续写文案，Ctrl+Enter 发送。
    优先剪贴板粘贴（中文稳）；失败再试 Unicode 直输。
    """
    found = find_paintingtools_hwnd(timeout=3.0)
    if not found:
        log("续写 结果=失败 原因=未找到工程窗")
        return False
    hwnd, _title = found
    win_util.force_foreground(hwnd)
    time.sleep(0.35)
    rect = win_util.get_rect(hwnd)
    if not rect:
        log("续写 结果=失败 原因=无窗口矩形")
        return False
    l, t, r, b = rect
    rx, ry = config.CHAT_INPUT_REL
    cx = int(l + (r - l) * rx)
    cy = int(t + (b - t) * ry)
    # 强制贴底：避免误点到右侧 Files 列表区域
    cy = max(cy, b - 48)
    cx = min(max(cx, l + 120), r - 120)
    text = prompt if prompt else config.CONTINUE_PROMPT
    try:
        import pyautogui

        pyautogui.FAILSAFE = False
        detect_tip._click_screen(cx, cy)
        time.sleep(0.45)
        # 清空输入框残留
        pyautogui.hotkey("ctrl", "a")
        time.sleep(0.12)
        method = "clipboard"
        try:
            _set_clipboard(text)
            time.sleep(0.15)
            pyautogui.hotkey("ctrl", "v")
        except Exception as e1:
            method = "unicode"
            try:
                _type_unicode(text)
            except Exception as e2:
                log(f"续写 结果=失败 原因=输入失败 clip={e1} unicode={e2}")
                return False
        time.sleep(0.35)
        pyautogui.hotkey("ctrl", "enter")
        time.sleep(0.25)
        log(f"续写 结果=成功 坐标={cx},{cy} 内容={text} 方式={method} 发送=Ctrl+Enter")
        return True
    except Exception as e:
        log(f"续写 结果=失败 原因={e}")
        return False


def save_all() -> bool:
    """对 Cursor 发全部保存（Ctrl+K, S）。"""
    if not focus_cursor():
        log("保存 全部 结果=跳过 原因=无Cursor窗口")
        return False
    try:
        import pyautogui

        pyautogui.FAILSAFE = False
        # Ctrl+K 再 S
        pyautogui.hotkey("ctrl", "k")
        time.sleep(0.25)
        pyautogui.press("s")
        time.sleep(0.4)
        log("保存 全部 结果=成功")
        return True
    except Exception as e:
        log(f"保存 全部 结果=失败 原因={e}")
        return False


def _cursor_exe_running() -> bool:
    """tasklist 粗查 Cursor.exe 是否在跑（辅助窗口判定）。"""
    try:
        r = subprocess.run(
            ["tasklist", "/FI", "IMAGENAME eq Cursor.exe", "/NH"],
            capture_output=True,
            text=True,
            timeout=8,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        out = (r.stdout or "") + (r.stderr or "")
        return "Cursor.exe" in out
    except Exception:
        return True  # 查失败时不阻断「窗口已消失」逻辑


def wait_cursor_restart(
    timeout: Optional[float] = None,
    gone_timeout: Optional[float] = None,
) -> bool:
    """
    真正重启判定：先等到 Cursor 窗口消失（可选进程也掉），再等到窗口重新出现。
    """
    timeout = timeout if timeout is not None else config.CURSOR_RESTART_TIMEOUT
    gone_timeout = (
        gone_timeout if gone_timeout is not None else config.CURSOR_GONE_TIMEOUT
    )
    t0 = time.time()

    gone = False
    while time.time() - t0 < gone_timeout:
        hwnds = find_cursor_hwnds()
        visible = [h for h, _t in hwnds if win_util.is_visible(h) and not win_util.is_iconic(h)]
        if not visible:
            time.sleep(0.8)
            hwnds2 = find_cursor_hwnds()
            visible2 = [
                h for h, _t in hwnds2 if win_util.is_visible(h) and not win_util.is_iconic(h)
            ]
            if not visible2:
                gone = True
                log(f"等待 Cursor重启 阶段=已关闭 耗时={time.time() - t0:.1f}秒")
                break
        time.sleep(0.5)

    if not gone:
        still_proc = _cursor_exe_running()
        log(
            "等待 Cursor重启 结果=失败 "
            f"原因=窗口未关闭 进程仍在={'是' if still_proc else '否'}"
        )
        return False

    while time.time() - t0 < timeout:
        hwnds = find_cursor_hwnds()
        visible = [h for h, _t in hwnds if win_util.is_visible(h) and not win_util.is_iconic(h)]
        if visible:
            try:
                win_util.force_foreground(visible[0])
            except Exception:
                pass
            elapsed = time.time() - t0
            log(f"等待 Cursor重启 结果=成功 耗时={elapsed:.1f}秒")
            wait_cursor_ui_ready()
            return True
        time.sleep(0.6)

    log("等待 Cursor重启 结果=失败 原因=关闭后未重新出现")
    return False


def _largest_cursor_rect():
    best = None
    best_area = 0
    for hwnd, _title in find_cursor_hwnds():
        if not win_util.is_onscreen(hwnd):
            continue
        rect = win_util.get_rect(hwnd)
        if not rect:
            continue
        area = (rect[2] - rect[0]) * (rect[3] - rect[1])
        if area > best_area:
            best_area = area
            best = (hwnd, rect)
    return best


def wait_cursor_ui_ready() -> None:
    """窗口已出现不等于界面画完，再等到主窗足够大。"""
    deadline = time.time() + config.CURSOR_UI_READY_WAIT
    while time.time() < deadline:
        found = _largest_cursor_rect()
        if found:
            hwnd, rect = found
            w, h = rect[2] - rect[0], rect[3] - rect[1]
            if w >= 800 and h >= 500:
                win_util.force_foreground(hwnd)
                time.sleep(1.2)
                log(f"等待 Cursor界面 结果=就绪 尺寸={w}x{h}")
                return
        time.sleep(0.5)
    log("等待 Cursor界面 结果=超时 仍继续")


def click_editor_window_if_any(timeout: Optional[float] = None) -> str:
    """有则点 Editor Window。优先在 Cursor 窗口内模板匹配，避免 UIA 遍历把时间耗光。"""
    wait = timeout if timeout is not None else config.EDITOR_WINDOW_WAIT
    deadline = time.time() + wait
    last_score = None
    while time.time() < deadline:
        found = _largest_cursor_rect()
        if found:
            hwnd, rect = found
            win_util.force_foreground(hwnd)
            box = detect_tip.match_template_in_abs_rect(
                "btn_editor_window.png", rect, threshold=0.72
            )
            if box:
                l, t, r, b, score = box
                last_score = score
                detect_tip._click_screen((l + r) // 2, (t + b) // 2)
                log(f"点击 EditorWindow 结果=成功 方式=窗口内模板 分数={score:.2f}")
                time.sleep(0.8)
                return "成功"
        time.sleep(0.5)
    extra = f" 最高分数={last_score:.2f}" if last_score else " 未匹配到模板"
    log(f"点击 EditorWindow 结果=跳过{extra}")
    return "跳过"


def _try_cli_open() -> bool:
    path = config.PROJECT_PATH
    # 1) cursor CLI
    try:
        r = subprocess.run(
            ["cursor", path],
            shell=True,
            capture_output=True,
            timeout=20,
        )
        if r.returncode == 0:
            return True
    except Exception:
        pass
    # 2) 常见安装路径
    for exe in config.CURSOR_EXE_CANDIDATES:
        if not exe or not os.path.isfile(exe):
            continue
        try:
            subprocess.Popen([exe, path], shell=False)
            time.sleep(2.0)
            return True
        except Exception:
            continue
    return False


def _click_recent_paintingtools() -> bool:
    """欢迎页 Recent 列表点 PaintingTools：先确认 Recent，再点项目名。"""
    # 欢迎页多在屏幕中部
    center = (0.2, 0.25, 0.8, 0.85)
    recent = detect_tip.match_template_on_screen(
        "lbl_recent_projects.png", threshold=0.8, roi_rel=center
    )
    box = detect_tip.match_template_on_screen(
        "btn_paintingtools.png", threshold=0.88, roi_rel=center
    )
    if box is None:
        box = detect_tip.match_template_on_screen(
            "btn_paintingtools.png", threshold=0.9
        )
    if box is None:
        return False
    # 若找到 Recent，要求 PaintingTools 在其下方附近，降低误点标题栏
    if recent is not None:
        rl, rt, rr, rb, _ = recent
        pl, pt, pr, pb, _ = box
        if pt < rt - 10 or pt > rb + 200:
            return False
        if pl < rl - 40:
            return False
    l, t, r, b, _ = box
    detect_tip._click_screen((l + r) // 2, (t + b) // 2)
    return True


def open_paintingtools() -> str:
    """
    打开工程：CLI 优先，失败再点 Recent。
    返回方式文案：命令行 / 点击Recent / 失败
    """
    if _try_cli_open():
        log("打开工程 PaintingTools 方式=命令行 结果=成功")
        return "命令行"
    # 等欢迎页
    deadline = time.time() + config.OPEN_PROJECT_TIMEOUT
    while time.time() < deadline:
        focus_cursor()
        if _click_recent_paintingtools():
            log("打开工程 PaintingTools 方式=点击Recent 结果=成功")
            return "点击Recent"
        time.sleep(1.0)
    log("打开工程 PaintingTools 方式=点击Recent 结果=失败")
    return "失败"
