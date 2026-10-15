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
        # 对话框在屏幕中部（略收 ROI，降低 matchTemplate 分配）
        x0, y0 = int(w * 0.25), int(h * 0.25)
        x1, y1 = int(w * 0.75), int(h * 0.75)
        roi = screen[y0:y1, x0:x1]

        tpl_cancel = detect_tip._load_template("btn_cancel_external.png")
        tpl_dlg = detect_tip._load_template("dlg_open_external.png")
        dlg_scales = getattr(config, "DIALOG_MATCH_SCALES", (1.0, 0.93))
        hit_c = detect_tip._match_scaled(roi, tpl_cancel, 0.78, scales=dlg_scales)
        hit_d = detect_tip._match_scaled(roi, tpl_dlg, 0.72, scales=dlg_scales)
        del screen, roi

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


def dismiss_update_recommended_dialog(timeout: float = 3.0) -> str:
    """
    关掉 Cursor 更新提示（非用量 tip）：
    - 「Update recommended」中央/条带（Close / ×）
    - 「Update Available」右下角 toast（×；有 Download Update 蓝钮）
    只点 Close / × / Esc；绝不点 Update / Download Update / Install / Restart。
    与用量上限 tip 严格分离：不用 tip_usage_* / tip_upgrade_btn 作证据，不触发换号。
    """
    deadline = time.time() + timeout
    # 文案共现关键字（UIA）；禁止把 Upgrade / usage limit 当更新提示
    text_hints = (
        "Update recommended",
        "Update Available",
        "newer version of Cursor",
        "recommend updating",
        "very old version of Cursor",
        "stops working on",
        "please update to the latest version",
        "Download Update",
        "提示更新",
        "建议更新",
        "有新版本",
        "发现更新",
    )
    # 永不点击的按钮文案（黑名单）
    never_click = (
        "update",
        "download update",
        "download",
        "install",
        "restart and update",
        "restart to update",
        "更新并重启",
        "立即更新",
        "安装更新",
        "下载更新",
    )
    # 允许点击的关闭侧文案（白名单）
    dismiss_labels = (
        "close",
        "not now",
        "later",
        "remind me later",
        "dismiss",
        "以后再说",
        "稍后",
        "关闭",
        "取消",
    )

    def _is_never_label(t: str) -> bool:
        low = (t or "").strip().lower()
        if not low:
            return False
        # 精确「Update」/「Download Update」等；避免误伤无关按钮
        if low == "update" or low.startswith("update "):
            return True
        if "download" in low and "update" in low:
            return True
        return any(k in low for k in never_click if k not in ("update", "download"))

    def _is_dismiss_label(t: str) -> bool:
        low = (t or "").strip().lower()
        if not low or _is_never_label(low):
            return False
        return low in dismiss_labels or any(low == d or low.startswith(d) for d in dismiss_labels)

    def _cursor_scan_rois(
        screen_h: int, screen_w: int, mon_l: int, mon_t: int
    ) -> list:
        """
        仅在 Cursor 主窗内取子 ROI（相对窗口比例）。
        无 Cursor 窗则空：避免在 Chrome/其它应用上误点。
        """
        rels = getattr(
            config,
            "UPDATE_DIALOG_ROIS",
            ((0.15, 0.02, 0.85, 0.55), (0.40, 0.50, 1.0, 0.98)),
        )
        rois = []
        for hwnd, _title in find_cursor_hwnds():
            if not win_util.is_onscreen(hwnd):
                continue
            rect = win_util.get_rect(hwnd)
            if not rect:
                continue
            wl, wt, wr, wb = rect
            ww, wh = wr - wl, wb - wt
            # 过小窗跳过；中等窗整窗扫（避免漏掉独立弹层）
            if ww < 280 or wh < 120:
                continue
            if ww < 700 or wh < 420:
                x0 = max(0, min(screen_w, wl - mon_l))
                y0 = max(0, min(screen_h, wt - mon_t))
                x1 = max(0, min(screen_w, wr - mon_l))
                y1 = max(0, min(screen_h, wb - mon_t))
                if x1 - x0 >= 80 and y1 - y0 >= 40:
                    rois.append((x0, y0, x1, y1))
                continue
            for rel in rels:
                ax0 = wl + int(ww * rel[0])
                ay0 = wt + int(wh * rel[1])
                ax1 = wl + int(ww * rel[2])
                ay1 = wt + int(wh * rel[3])
                # 转成相对主屏截图坐标
                x0 = max(0, min(screen_w, ax0 - mon_l))
                y0 = max(0, min(screen_h, ay0 - mon_t))
                x1 = max(0, min(screen_w, ax1 - mon_l))
                y1 = max(0, min(screen_h, ay1 - mon_t))
                if x1 - x0 < 80 or y1 - y0 < 40:
                    continue
                rois.append((x0, y0, x1, y1))
        return rois

    def _available_fast_rois(
        screen_h: int, screen_w: int, mon_l: int, mon_t: int
    ) -> list:
        """右下角 Update Available：只扫 Cursor 窗底部 chat 带，少算匹配。"""
        rel = getattr(config, "UPDATE_AVAILABLE_ROI", (0.48, 0.62, 1.0, 0.99))
        rois = []
        for hwnd, _title in find_cursor_hwnds():
            if not win_util.is_onscreen(hwnd):
                continue
            rect = win_util.get_rect(hwnd)
            if not rect:
                continue
            wl, wt, wr, wb = rect
            ww, wh = wr - wl, wb - wt
            if ww < 400 or wh < 300:
                continue
            ax0 = wl + int(ww * rel[0])
            ay0 = wt + int(wh * rel[1])
            ax1 = wl + int(ww * rel[2])
            ay1 = wt + int(wh * rel[3])
            x0 = max(0, min(screen_w, ax0 - mon_l))
            y0 = max(0, min(screen_h, ay0 - mon_t))
            x1 = max(0, min(screen_w, ax1 - mon_l))
            y1 = max(0, min(screen_h, ay1 - mon_t))
            if x1 - x0 >= 80 and y1 - y0 >= 40:
                rois.append((x0, y0, x1, y1))
        return rois

    def _dismiss_available_fast(screen, mon_l: int, mon_t: int) -> bool:
        """
        专关右下「Update Available」：少尺度 + 小 ROI。
        标题或 EOL 正文命中后优先点 × 模板，再几何估右上角；不点 Download Update。
        按 Cursor 窗宽估算优先尺度（模板来自约 1024 宽截图）。
        """
        h, w = screen.shape[:2]
        base_scales = getattr(
            config,
            "UPDATE_AVAILABLE_FAST_SCALES",
            (1.7, 1.6, 1.8, 1.5, 2.0, 2.15, 2.3, 1.0),
        )
        thr = float(getattr(config, "UPDATE_AVAILABLE_TITLE_MIN", 0.78))
        thr_body = float(getattr(config, "UPDATE_AVAILABLE_BODY_MIN", 0.78))
        thr_x = float(getattr(config, "UPDATE_AVAILABLE_X_MIN", 0.72))
        tpl = detect_tip._load_template("dlg_update_available.png")
        body_tpls = [
            detect_tip._load_template(n)
            for n in (
                "dlg_update_available_eol_body.png",
                "dlg_update_available_body.png",
                "dlg_update_eol_body.png",
            )
        ]
        body_tpls = [t for t in body_tpls if t is not None]
        tpl_x = detect_tip._load_template("btn_dismiss_update_x.png")
        if tpl is None and not body_tpls:
            return False
        for x0, y0, x1, y1 in _available_fast_rois(h, w, mon_l, mon_t):
            # 用 ROI 宽度反推窗宽比例，优先试最接近的尺度
            est = max(0.9, min(2.5, (x1 - x0) / max(1, int(w * 0.52))))
            # ROI 约为窗宽 52%；更稳：直接用 Cursor 窗宽
            prefer = []
            for hwnd, _t in find_cursor_hwnds():
                rect = win_util.get_rect(hwnd) if win_util.is_onscreen(hwnd) else None
                if not rect:
                    continue
                ww = rect[2] - rect[0]
                if ww >= 400:
                    prefer.append(round(ww / 1024.0, 2))
                    break
            if not prefer:
                prefer = [round(est, 2)]
            # 优先尺度 + 邻近档 + 配置表（去重）
            ordered: list[float] = []
            for s in (
                prefer[0],
                prefer[0] - 0.1,
                prefer[0] + 0.1,
                prefer[0] - 0.05,
                prefer[0] + 0.05,
                *base_scales,
            ):
                s = round(float(s), 2)
                if s < 0.85 or s > 2.6:
                    continue
                if s not in ordered:
                    ordered.append(s)
            fast_scales = tuple(ordered)

            roi = screen[y0:y1, x0:x1]
            hit = None
            how = "标题"
            if tpl is not None:
                hit = detect_tip._match_scaled(roi, tpl, thr, scales=fast_scales)
            if hit is None:
                for bt in body_tpls:
                    hit = detect_tip._match_scaled(
                        roi, bt, thr_body, scales=fast_scales
                    )
                    if hit is not None:
                        how = "正文"
                        break
            if hit is None:
                # 近失日志，便于下次对照窗宽/尺度
                soft = None
                if tpl is not None:
                    soft = detect_tip._match_scaled(
                        roi, tpl, 0.60, scales=fast_scales[:6]
                    )
                if soft is not None and soft[0] >= 0.70:
                    log(
                        f"对话框 更新提示 近失 available 最高={soft[0]:.2f} "
                        f"阈值={thr:.2f} 优先尺度={prefer[0]}"
                    )
                del roi
                continue
            score, lx, ly, tw, th = hit
            # 优先用 × 模板精点（几何估在高分屏易偏）
            cx = cy = None
            way = "快路径X"
            if tpl_x is not None:
                # 只在标题/正文右侧搜 ×，避免点到别处
                sx0 = max(0, lx + (tw if how == "标题" else 0))
                sy0 = max(0, ly - 12)
                sx1 = min(roi.shape[1], lx + max(tw * 4, tw + 360))
                sy1 = min(roi.shape[0], ly + max(th + 40, 70))
                if sx1 - sx0 >= 24 and sy1 - sy0 >= 16:
                    sub = roi[sy0:sy1, sx0:sx1]
                    hit_x = detect_tip._match_scaled(
                        sub, tpl_x, thr_x, scales=fast_scales
                    )
                    if hit_x is not None:
                        xs, xx, xy, xw, xh = hit_x
                        cx = mon_l + x0 + sx0 + xx + xw // 2
                        cy = mon_t + y0 + sy0 + xy + xh // 2
                        way = "快路径X模板"
                        score = max(score, xs)
            if cx is None:
                # ×：按 toast 约 3×标题宽估右上角；正文命中则略上移到标题行
                toast_w = max(int(tw * 3.1), int(tw + 280 * (tw / max(tw, 146))))
                if how == "正文":
                    toast_w = max(int(tw * 1.15), tw + 40)
                    cx = mon_l + x0 + lx + toast_w - 18
                    cy = mon_t + y0 + ly - max(10, th // 4)
                else:
                    cx = mon_l + x0 + lx + toast_w - 22
                    cy = mon_t + y0 + ly + max(8, th // 2)
                cx = min(max(cx, mon_l + x0 + lx + tw + 40), mon_l + x1 - 10)
                cy = min(max(cy, mon_t + y0 + 6), mon_t + y1 - 12)
            detect_tip._click_screen(int(cx), int(cy))
            log(
                f"对话框 更新提示 结果=已关闭 方式={way} "
                f"样式=available 依据={how} 分数={score:.2f} 坐标={cx},{cy}"
            )
            del roi
            time.sleep(0.35)
            return True
        return False

    def _click_dismiss_by_template() -> bool:
        screen, mon_l, mon_t = detect_tip.grab_screen_bgr()
        # 先快关右下 Update Available（主循环超时内必须能跑完）
        try:
            if _dismiss_available_fast(screen, mon_l, mon_t):
                del screen
                return True
        except Exception as e:
            log(f"对话框 更新提示 快路径异常 {e}")

        h, w = screen.shape[:2]
        thr_t = float(getattr(config, "UPDATE_TITLE_THRESHOLD", 0.86))
        thr_b = float(getattr(config, "UPDATE_BODY_THRESHOLD", 0.84))
        dual_min = float(getattr(config, "UPDATE_DUAL_MIN_SCORE", 0.78))
        single_hi = float(getattr(config, "UPDATE_SINGLE_HIGH_SCORE", 0.92))
        thr_close = float(getattr(config, "UPDATE_CLOSE_THRESHOLD", 0.78))

        scan_rois = _cursor_scan_rois(h, w, mon_l, mon_t)
        if not scan_rois:
            del screen
            return False

        # available 已由快路径处理；此处扫中央 Update recommended（含到期 EOL 文案）
        # body 可为旧「newer version」或新「stops working」任选一命中
        evidence_packs = (
            (
                "dlg_update_recommended.png",
                ("dlg_update_eol_body.png", "dlg_update_body.png"),
                "btn_close_update.png",
                "btn_dismiss_update_x.png",
                "recommended",
            ),
        )
        rec_scales = getattr(
            config,
            "UPDATE_RECOMMENDED_SCALES",
            (1.7, 1.6, 1.8, 1.5, 2.0, 2.15, 1.0),
        )
        # 按窗宽优先尺度
        prefer_s = None
        for hwnd, _t in find_cursor_hwnds():
            rect = win_util.get_rect(hwnd) if win_util.is_onscreen(hwnd) else None
            if rect and rect[2] - rect[0] >= 400:
                prefer_s = round((rect[2] - rect[0]) / 1024.0, 2)
                break
        if prefer_s:
            ordered_s: list[float] = []
            for s in (prefer_s, prefer_s - 0.1, prefer_s + 0.1, *rec_scales):
                s = round(float(s), 2)
                if 0.85 <= s <= 2.6 and s not in ordered_s:
                    ordered_s.append(s)
            rec_scales = tuple(ordered_s)

        for x0, y0, x1, y1 in scan_rois:
            if time.time() >= deadline - 0.15:
                break
            roi = screen[y0:y1, x0:x1]
            for title_n, body_names, close_n, x_n, style in evidence_packs:
                use_scales = rec_scales
                tpl_title = detect_tip._load_template(title_n)
                if isinstance(body_names, str):
                    body_names = (body_names,)
                hit_t = detect_tip._match_scaled(
                    roi, tpl_title, dual_min, scales=use_scales
                )
                hit_b = None
                for body_n in body_names:
                    cand = detect_tip._match_scaled(
                        roi,
                        detect_tip._load_template(body_n),
                        dual_min,
                        scales=use_scales,
                    )
                    if cand is None:
                        continue
                    if hit_b is None or cand[0] > hit_b[0]:
                        hit_b = cand
                hit_c = None
                if close_n:
                    hit_c = detect_tip._match_scaled(
                        roi,
                        detect_tip._load_template(close_n),
                        thr_close,
                        scales=use_scales,
                    )

                if hit_t is None and hit_b is None:
                    continue

                dual_ok = False
                single_ok = False
                # 双证 A：标题 + 正文邻近
                if hit_t is not None and hit_b is not None:
                    _st, lx_t, ly_t, tw_t, th_t = hit_t
                    _sb, lx_b, ly_b, tw_b, th_b = hit_b
                    near = (ly_b + 8 >= ly_t) and (ly_b <= ly_t + th_t + 80)
                    near = near and (abs(lx_t - lx_b) < 220)
                    if near and hit_t[0] >= dual_min and hit_b[0] >= dual_min:
                        if hit_t[0] >= thr_t or hit_b[0] >= thr_b:
                            dual_ok = True
                # 双证 B：标题 + Close（正文尺度失败时的稳妥路径，Close≠Update）
                if (
                    not dual_ok
                    and hit_t is not None
                    and hit_c is not None
                    and hit_t[0] >= dual_min
                    and hit_c[0] >= thr_close
                ):
                    _st, lx_t, ly_t, tw_t, th_t = hit_t
                    sc, clx, cly, ctw, cth = hit_c
                    near_c = (abs(cly - ly_t) < 140) and (clx > lx_t - 20)
                    if near_c and (hit_t[0] >= thr_t or sc >= 0.88):
                        dual_ok = True

                if not dual_ok:
                    if hit_t is not None and hit_t[0] >= single_hi:
                        single_ok = True
                    elif hit_b is not None and hit_b[0] >= single_hi:
                        single_ok = True
                if not dual_ok and not single_ok:
                    continue

                title_or_body = hit_t if hit_t is not None else hit_b
                if dual_ok and hit_t is not None:
                    title_or_body = hit_t
                score_tb, lx, ly, tw, th = title_or_body
                from_title = hit_t is not None

                # 优先点 Close（已共现则直接点；禁止点 Update）
                if hit_c is not None:
                    sc, clx, cly, ctw, cth = hit_c
                    near = (abs(cly - ly) < 140) and (clx + ctw // 2 > lx - 40)
                    if near and sc >= thr_close:
                        cx = mon_l + x0 + clx + ctw // 2
                        cy = mon_t + y0 + cly + cth // 2
                        detect_tip._click_screen(int(cx), int(cy))
                        log(
                            f"对话框 更新提示 结果=已关闭 方式=Close模板 "
                            f"样式={style} 分数={max(score_tb, sc):.2f} "
                            f"坐标={cx},{cy}"
                        )
                        del screen, roi
                        time.sleep(0.4)
                        return True

                # 其次点右上角 × 模板
                if x_n:
                    hit_x = detect_tip._match_scaled(
                        roi,
                        detect_tip._load_template(x_n),
                        thr_close,
                        scales=use_scales,
                    )
                    if hit_x is not None:
                        sc, xl, yl, xw, xh = hit_x
                        if abs(yl - ly) < 50 and xl > lx and sc >= thr_close:
                            cx = mon_l + x0 + xl + xw // 2
                            cy = mon_t + y0 + yl + xh // 2
                            detect_tip._click_screen(int(cx), int(cy))
                            log(
                                f"对话框 更新提示 结果=已关闭 方式=关闭X模板 "
                                f"样式={style} 分数={max(score_tb, sc):.2f} "
                                f"坐标={cx},{cy}"
                            )
                            del screen, roi
                            time.sleep(0.4)
                            return True

                # 几何点 × / Close：
                # - recommended：须双证（防 Chrome 误点）
                # - available：标题「Update Available」足够独特；高分标题即可点右上 ×
                #   （高分屏上正文常略低于阈值，否则永远关不掉右下角 toast）
                allow_geo = dual_ok
                if (
                    not allow_geo
                    and style == "available"
                    and hit_t is not None
                    and hit_t[0] >= thr_t
                ):
                    allow_geo = True
                if not allow_geo:
                    continue
                if style == "available":
                    # × 在标题行最右侧；绝不点下方 Download Update 蓝钮
                    x_off = max(280, int(tw * 1.6))
                    if from_title:
                        cx = mon_l + x0 + lx + tw + x_off
                        cy = mon_t + y0 + ly + max(8, th // 2)
                    else:
                        cx = mon_l + x0 + lx + tw + 80
                        cy = mon_t + y0 + ly - 14
                else:
                    # Close 约在标题右下方（勿点更右侧的 Update 蓝钮）
                    cx = mon_l + x0 + lx + tw + 90
                    cy = mon_t + y0 + ly + th + 28
                cx = min(max(cx, mon_l + x0 + 10), mon_l + x1 - 16)
                cy = min(max(cy, mon_t + y0 + 8), mon_t + y1 - 16)
                detect_tip._click_screen(int(cx), int(cy))
                ft = f"{hit_t[0]:.2f}" if hit_t else "-"
                fb = f"{hit_b[0]:.2f}" if hit_b else "-"
                log(
                    f"对话框 更新提示 结果=已关闭 方式=几何点X "
                    f"样式={style} 分数={score_tb:.2f} "
                    f"双证={ft}/{fb} 坐标={cx},{cy}"
                )
                del screen, roi
                time.sleep(0.4)
                return True
            del roi
        del screen
        return False

    while time.time() < deadline:
        try:
            if _click_dismiss_by_template():
                return "已关闭"
        except Exception as e:
            log(f"对话框 更新提示 模板异常 {e}")

        try:
            from pywinauto import Desktop

            desk = Desktop(backend="uia")
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
                    texts = []
                    buttons = []
                    for ctrl in win.descendants(control_type="Button"):
                        buttons.append(ctrl)
                        t = (ctrl.window_text() or "").strip()
                        if t:
                            texts.append(t)
                    for ctrl in win.descendants(control_type="Text"):
                        t = (ctrl.window_text() or "").strip()
                        if t:
                            texts.append(t)
                    blob = "\n".join(texts)
                    if not any(h in blob for h in text_hints):
                        continue
                    # 窗口客户区：禁止点标题栏「关闭」（曾误点 y≈21 / y≈212 顶栏旁控件）
                    try:
                        wr = win.rectangle()
                        win_top = int(wr.top)
                        win_bottom = int(wr.bottom)
                        win_h = max(1, win_bottom - win_top)
                    except Exception:
                        win_top = 0
                        win_h = 1000
                    title_bar_y = win_top + 48
                    # Available toast 的 × 多在窗下半；上半 Close 常是面板/标签关闭
                    toast_band_y = win_top + int(win_h * 0.45)

                    # 优先 Close（英文弹窗）；须靠近 Update 蓝钮或落在 toast 带
                    update_btns = []
                    for b in buttons:
                        try:
                            bt = (b.window_text() or "").strip()
                        except Exception:
                            continue
                        if _is_never_label(bt):
                            try:
                                br = b.rectangle()
                                update_btns.append(
                                    (
                                        (br.left + br.right) // 2,
                                        (br.top + br.bottom) // 2,
                                    )
                                )
                            except Exception:
                                pass
                    has_update_btn = bool(update_btns)
                    available_hint = any(
                        h in blob
                        for h in (
                            "Update Available",
                            "Download Update",
                            "stops working on",
                            "very old version of Cursor",
                        )
                    )
                    candidates = []
                    for ctrl in buttons:
                        try:
                            t = (ctrl.window_text() or "").strip()
                        except Exception:
                            continue
                        if _is_never_label(t):
                            continue
                        if not _is_dismiss_label(t):
                            continue
                        try:
                            rr = ctrl.rectangle()
                            cx = (rr.left + rr.right) // 2
                            cy = (rr.top + rr.bottom) // 2
                        except Exception:
                            continue
                        if cx <= 0 or cy <= 0:
                            continue
                        if cy < title_bar_y:
                            continue  # 标题栏
                        near_update = False
                        for ux, uy in update_btns:
                            if abs(cx - ux) < 420 and abs(cy - uy) < 160:
                                near_update = True
                                break
                        # Available 右下 toast：无邻近 Update 钮的上半 Close 一律跳过
                        if available_hint and not near_update and cy < toast_band_y:
                            continue
                        # 「关闭」若无 Update 类按钮共现，且贴窗顶，易误伤
                        if t == "关闭" and not has_update_btn and cy < win_top + 120:
                            continue
                        # 无邻近 Update 时，上半 Close 也不点（防误关面板）
                        if not near_update and cy < win_top + 220:
                            continue
                        # 优先：靠近 Update 钮 > Close 文案 > 越靠下越好（toast）
                        prio = (
                            0 if near_update else 2,
                            0 if t.lower() == "close" else 1,
                            -cy,
                        )
                        candidates.append((prio, cy, cx, t, ctrl))
                    candidates.sort()
                    for _prio, cy, cx, t, ctrl in candidates:
                        try:
                            detect_tip._click_screen(cx, cy)
                            log(
                                f"对话框 更新提示 结果=已关闭 "
                                f"方式=控件 label={t} 坐标={cx},{cy}"
                            )
                            time.sleep(0.45)
                            return "已关闭"
                        except Exception:
                            continue
                    # Esc 兜底（有更新文案时）
                    try:
                        import pyautogui

                        win_util.force_foreground(int(win.handle))
                        pyautogui.FAILSAFE = False
                        pyautogui.press("esc")
                        log("对话框 更新提示 结果=已关闭 方式=Esc")
                        time.sleep(0.4)
                        return "已关闭"
                    except Exception as e:
                        log(f"对话框 更新提示 结果=失败 原因={e}")
                except Exception:
                    continue
        except Exception as e:
            log(f"对话框 更新提示 扫描异常 {e}")

        # Esc 兜底：须在 Cursor 窗内、标题+正文双证（避免 Chrome 弱匹配乱按 Esc）
        try:
            screen, mon_l, mon_t = detect_tip.grab_screen_bgr()
            sh, sw = screen.shape[:2]
            rois = _cursor_scan_rois(sh, sw, mon_l, mon_t)
            dlg_scales = getattr(
                config,
                "UPDATE_DIALOG_MATCH_SCALES",
                (1.0, 0.93),
            )
            dual_min = float(getattr(config, "UPDATE_DUAL_MIN_SCORE", 0.80))
            thr_t = float(getattr(config, "UPDATE_TITLE_THRESHOLD", 0.86))
            thr_b = float(getattr(config, "UPDATE_BODY_THRESHOLD", 0.84))
            pairs = (
                ("dlg_update_recommended.png", "dlg_update_eol_body.png"),
                ("dlg_update_recommended.png", "dlg_update_body.png"),
                ("dlg_update_available.png", "dlg_update_available_eol_body.png"),
                ("dlg_update_available.png", "dlg_update_available_body.png"),
            )
            esc_ok = False
            for x0, y0, x1, y1 in rois:
                roi = screen[y0:y1, x0:x1]
                for tn, bn in pairs:
                    ht = detect_tip._match_scaled(
                        roi, detect_tip._load_template(tn), dual_min, scales=dlg_scales
                    )
                    hb = detect_tip._match_scaled(
                        roi, detect_tip._load_template(bn), dual_min, scales=dlg_scales
                    )
                    if ht is None or hb is None:
                        continue
                    if ht[0] < dual_min or hb[0] < dual_min:
                        continue
                    if ht[0] < thr_t and hb[0] < thr_b:
                        continue
                    # 纵向邻近
                    if not (hb[2] + 8 >= ht[2] and hb[2] <= ht[2] + ht[4] + 80):
                        continue
                    esc_ok = True
                    break
                if esc_ok:
                    break
            del screen
            if esc_ok:
                import pyautogui

                pyautogui.FAILSAFE = False
                pyautogui.press("esc")
                log("对话框 更新提示 结果=已关闭 方式=Esc双证兜底")
                time.sleep(0.4)
                return "已关闭"
        except Exception:
            pass
        time.sleep(0.3)
    return "跳过"


def dismiss_blocking_dialogs(rounds: int = 2) -> None:
    """换号后连续清挡路弹窗（更新提示、外部网站确认等）。"""
    for _ in range(max(1, rounds)):
        # 重启后更新广告常晚几秒出现；单轮多给一点时间与尺度尝试
        r_upd = dismiss_update_recommended_dialog(timeout=3.5)
        r_ext = dismiss_external_site_dialog(timeout=2.5)
        if r_upd == "跳过" and r_ext == "跳过":
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
