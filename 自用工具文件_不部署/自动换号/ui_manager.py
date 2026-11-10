# -*- coding: utf-8 -*-
"""Cursor 续杯管家：前置窗口、点「无感换号 / 重置机器码」及确认弹窗（WebView，模板匹配）。"""
from __future__ import annotations

import ctypes
import time
from typing import List, Optional, Tuple

import cv2
import numpy as np

import config
import detect_tip
import ui_cursor
import win_util
from logutil import log

WM_SYSCOMMAND = 0x0112
SC_RESTORE = 0xF120

# 本进程内：若管家提示需「注入」才启用无感换号，只点一次「注入」
_inject_clicked_once = False
# 换号时短暂最小化的 Cursor 编辑器 hwnd，点完/失败后还原
_minimized_cursor_hwnds: list = []


def _manager_title_hit(title: str) -> bool:
    t = title or ""
    key = getattr(config, "MANAGER_TITLE", "Cursor续杯管家")
    if key in t:
        return True
    # 短关键字兜底（标题可能带 [管理员运行模式] 等后缀）
    return "续杯管家" in t


def find_manager_hwnds() -> List[Tuple[int, str]]:
    hits = []
    for hwnd, title in win_util.enum_top_windows():
        if not title:
            continue
        if _manager_title_hit(title):
            hits.append((hwnd, title))
    hits.sort(key=lambda it: win_util._window_rank(it[0]), reverse=True)
    return hits


def find_manager_hwnd() -> Optional[Tuple[int, str]]:
    hits = find_manager_hwnds()
    if not hits:
        return None
    return hits[0]


def _foreground_title() -> str:
    try:
        fg = ctypes.windll.user32.GetForegroundWindow()
        if not fg:
            return ""
        return (win_util._window_text(int(fg)) or "")[:48]
    except Exception:
        return ""


def restore_minimized_cursor() -> list:
    """换号结束（成功或失败）后还原被短暂最小化的 Cursor。返回已在屏 hwnd。"""
    global _minimized_cursor_hwnds
    restored: list = []
    if not _minimized_cursor_hwnds:
        return restored
    try:
        restored = ui_cursor.restore_editors_after_switch(list(_minimized_cursor_hwnds))
    finally:
        _minimized_cursor_hwnds = []
    return restored or []


def release_manager_after_switch() -> list:
    """点完无感换号并等待生效后：取消管家置顶 + 还原 Cursor。返回已还原 hwnd。"""
    found = find_manager_hwnd()
    if found:
        try:
            win_util.set_topmost(int(found[0]), False)
        except Exception:
            pass
    return restore_minimized_cursor()


def focus_manager() -> bool:
    """
    还原并置前续杯管家。若 Cursor 抢前台导致只闪任务栏：
    短暂最小化 Cursor 编辑器，再置顶管家（失败截图曾证实截到的仍是 Cursor）。
    """
    global _minimized_cursor_hwnds
    hits = find_manager_hwnds()
    if not hits:
        log("管家 前置窗口 结果=失败 原因=未找到")
        names = []
        for hwnd, title in win_util.enum_top_windows():
            if title and ("Cursor" in title or "管家" in title or "续杯" in title):
                names.append(title[:60])
        if names:
            log("管家 候选窗口 " + " | ".join(names[:12]))
        return False

    log(f"管家 找到窗口数={len(hits)}")
    if len(hits) > 1:
        log("警告 发现多个续杯管家窗口 请只保留一个")
    for hwnd, title in hits:
        rect = win_util.get_rect(hwnd) or (0, 0, 0, 0)
        log(
            f"管家 尝试置前 标题={title} hwnd={hwnd} "
            f"最小化={'是' if win_util.is_iconic(hwnd) else '否'} "
            f"在屏={'是' if win_util.is_onscreen(hwnd) else '否'} "
            f"矩形={rect[0]},{rect[1]}-{rect[2]},{rect[3]}"
        )
        ok = False
        for attempt in range(1, 4):
            # 1) 托盘/最小化：先还原管家
            if win_util.is_iconic(hwnd) or not win_util.is_onscreen(hwnd):
                try:
                    ctypes.windll.user32.PostMessageW(hwnd, WM_SYSCOMMAND, SC_RESTORE, 0)
                except Exception:
                    pass
                win_util.restore_window_onscreen(hwnd)
                time.sleep(0.35 if attempt == 1 else 0.55)

            # 2) 一律先硬最小化 Cursor（已验证：不缩 Cursor 时截图仍是编辑器）
            log(
                f"管家 前置步骤 尝试={attempt} "
                f"当前前台={_foreground_title() or '-'} → 先最小化Cursor"
            )
            newly = ui_cursor.minimize_editors_for_switch()
            for h in newly:
                if h not in _minimized_cursor_hwnds:
                    _minimized_cursor_hwnds.append(h)
            time.sleep(0.3)

            # 3) AHK 激活管家（严格以前台为准）；失败再 Win32 置顶
            ahk_ok = False
            if win_util.find_autohotkey():
                ahk_ok = win_util.activate_via_ahk(int(hwnd), minimize_hwnd=None)
                log(f"管家 AHK激活 结果={'成功' if ahk_ok else '失败'}")
            if not ahk_ok:
                win_util.force_foreground(hwnd, keep_topmost=True)
                time.sleep(0.2)
            try:
                if not win_util.is_zoomed(hwnd):
                    win_util.maximize(hwnd)
                    time.sleep(0.25)
            except Exception:
                pass
            win_util.set_topmost(hwnd, True)
            time.sleep(0.25)

            onscreen = win_util.is_onscreen(hwnd)
            iconic = win_util.is_iconic(hwnd)
            fg_ok = win_util.is_foreground(hwnd)
            zoomed = win_util.is_zoomed(hwnd)
            cursor_away = bool(_minimized_cursor_hwnds)

            # 成功：管家在屏，且（真前台 或 Cursor 已让开）
            if onscreen and not iconic and (fg_ok or cursor_away):
                # 若仍非前台但 Cursor 已缩：再 AHK/置顶一次提高点击命中
                if not fg_ok and win_util.find_autohotkey():
                    win_util.activate_via_ahk(int(hwnd))
                    fg_ok = win_util.is_foreground(hwnd)
                log(
                    f"管家 前置窗口 结果=成功 尝试={attempt} "
                    f"前台={'是' if fg_ok else '否'} "
                    f"最小化Cursor={'是' if cursor_away else '否'} "
                    f"最大化={'是' if zoomed else '否'}（置顶中）"
                )
                ok = True
                break
            log(
                f"管家 前置窗口 重试={attempt} "
                f"在屏={'是' if onscreen else '否'} 最小化={'是' if iconic else '否'} "
                f"前台窗={_foreground_title() or '-'} "
                f"已缩Cursor={'是' if cursor_away else '否'}"
            )
            time.sleep(0.4)
        if ok:
            return True
        try:
            win_util.set_topmost(hwnd, False)
        except Exception:
            pass

    log("管家 前置窗口 结果=失败 原因=未能还原到屏幕上（请先手动打开续杯管家窗口）")
    restore_minimized_cursor()
    return False


def _manager_match_scales(ww: int) -> tuple[float, ...]:
    """模板来自整屏约 1024 宽截图；实机管家窗常更宽。无感换号优先窄档，少扫加速。"""
    prefer = round(max(0.85, min(2.5, ww / 700.0)), 2)
    ordered: list[float] = []
    for s in (
        prefer,
        prefer - 0.1,
        prefer + 0.1,
        prefer - 0.2,
        prefer + 0.2,
        1.0,
        1.3,
        1.5,
        2.0,
        2.2,
    ):
        s = round(float(s), 2)
        if 0.75 <= s <= 2.6 and s not in ordered:
            ordered.append(s)
    return tuple(ordered)


def _click_blue_grid_fallback(
    roi: np.ndarray,
    mon_l: int,
    mon_t: int,
    x0: int,
    y0: int,
    action_cn: str,
) -> bool:
    """
    模板失败时：在按钮带内找浅蓝大钮，点左上格（无感换号）。
    不点红色「重置机器码」；不点贴底区域。
    """
    h, w = roi.shape[:2]
    # 距底边比例 → 扫描带（仅贴底大钮，避开中部发送条）
    fb = getattr(config, "SEAMLESS_BLUE_FROM_BOTTOM", (0.10, 0.30))
    y_cut = int(h * (1.0 - float(fb[1])))
    y_end = int(h * (1.0 - float(fb[0])))
    xmin = float(getattr(config, "SEAMLESS_HIT_X_MIN", 0.45))
    xmax = float(getattr(config, "SEAMLESS_HIT_X_MAX", 0.72))
    x_cut = int(w * xmin)
    x_end = int(w * xmax)
    sub = roi[y_cut:y_end, x_cut:x_end, :]
    if sub.size == 0 or sub.shape[0] < 40:
        return False
    hsv = cv2.cvtColor(sub, cv2.COLOR_BGR2HSV)
    mask = (
        (hsv[:, :, 0] >= 90)
        & (hsv[:, :, 0] <= 130)
        & (hsv[:, :, 1] >= 40)
        & (hsv[:, :, 2] >= 130)
    )
    mask_u8 = cv2.morphologyEx(
        (mask.astype(np.uint8) * 255),
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_RECT, (5, 3)),
        iterations=2,
    )
    n, _lab, stats, _c = cv2.connectedComponentsWithStats(mask_u8, 8)
    cands = []
    for i in range(1, n):
        x, y, bw, bh, ar = stats[i]
        # 底栏大钮约高 40～70；过扁多为分隔条
        if ar < 1200 or bw < 90 or bh < 28 or bh > 90:
            continue
        # 过宽多半是两钮粘连：只取左半
        if bw > int(w * 0.35):
            bw = bw // 2
        patch = sub[y : y + bh, x : x + bw]
        mean = patch.mean(axis=(0, 1))
        if mean[0] > mean[2] + 15:
            continue
        cands.append((y, x, bw, bh, ar))
    if not cands:
        return False
    # 同带内取最左（无感换号在「指定路径」左侧）
    cands.sort(key=lambda t: (t[1], t[0]))
    y, x, bw, bh, _ar = cands[0]
    x = x + x_cut
    cx = mon_l + x0 + x + bw // 2
    cy = mon_t + y0 + y_cut + y + bh // 2
    _click_seamless_at(cx, cy)
    log(
        f"点击 {action_cn} 结果=成功 方式=蓝钮网格兜底 "
        f"坐标={cx},{cy} 候选数={len(cands)}"
    )
    time.sleep(0.4)
    return True


def _click_template_in_manager(
    template_name: str,
    action_cn: str,
    thr: float,
) -> bool:
    """前置管家后在窗内匹配模板并点击中心。"""
    if not focus_manager():
        return False
    found = find_manager_hwnd()
    if found is None:
        log(f"点击 {action_cn} 结果=失败 原因=窗口丢失")
        return False
    hwnd, title = found
    rect = win_util.get_rect(hwnd)
    if not rect:
        log(f"点击 {action_cn} 结果=失败 原因=无窗口矩形")
        return False
    wl, wt, wr, wb = rect
    ww, wh = wr - wl, wb - wt
    if ww < 200 or wh < 200:
        log(f"点击 {action_cn} 结果=失败 原因=窗口过小 {ww}x{wh}")
        return False

    tpl = detect_tip._load_template(template_name)
    if tpl is None:
        log(f"点击 {action_cn} 结果=失败 原因=缺少模板 {template_name}")
        return False

    screen, mon_l, mon_t = detect_tip.grab_screen_bgr()
    sh, sw = screen.shape[:2]
    x0 = max(0, min(sw, wl - mon_l))
    y0 = max(0, min(sh, wt - mon_t))
    x1 = max(0, min(sw, wr - mon_l))
    y1 = max(0, min(sh, wb - mon_t))
    if x1 - x0 < 80 or y1 - y0 < 80:
        log(f"点击 {action_cn} 结果=失败 原因=截屏ROI无效")
        del screen
        return False

    roi = screen[y0:y1, x0:x1]
    scales = _manager_match_scales(ww)
    # 全尺度软扫，避免 scales 前几档全偏导致「未匹配」无近失信息
    hit = detect_tip._match_scaled(roi, tpl, thr, scales=scales)
    if hit is None:
        soft = detect_tip._match_scaled(roi, tpl, 0.50, scales=scales)
        soft_score = soft[0] if soft is not None else 0.0
        # 近失放宽阈值须很高；实机 0.72 曾误点窗底，默认约等于关闭
        soft_ok = float(getattr(config, "SEAMLESS_SWITCH_SOFT_OK", 0.92))
        if (
            action_cn == "无感换号"
            and soft is not None
            and soft[0] >= soft_ok
            and _seamless_y_ok(soft[2], soft[4], roi.shape[0])
            and _seamless_x_ok(soft[1], soft[3], roi.shape[1])
        ):
            score, lx, ly, tw, th = soft
            cx = mon_l + x0 + lx + tw // 2
            cy = mon_t + y0 + ly + th // 2
            _click_seamless_at(cx, cy)
            log(
                f"点击 {action_cn} 结果=成功 方式=近失放宽 "
                f"分数={score:.2f} 阈值={thr:.2f} 坐标={cx},{cy}"
            )
            del screen, roi
            time.sleep(0.4)
            return True
        if action_cn == "无感换号" and _click_blue_grid_fallback(
            roi, mon_l, mon_t, x0, y0, action_cn
        ):
            del screen, roi
            return True
        if soft is not None:
            log(
                f"点击 {action_cn} 结果=失败 近失={soft_score:.2f} "
                f"阈值={thr:.2f} 窗宽={ww} 优先尺度={scales[0]}"
            )
        else:
            log(f"点击 {action_cn} 结果=失败 原因=未匹配 窗宽={ww}")
        del screen, roi
        return False

    score, lx, ly, tw, th = hit
    if action_cn == "无感换号" and (
        not _seamless_y_ok(ly, th, roi.shape[0])
        or not _seamless_x_ok(lx, tw, roi.shape[1])
    ):
        y_rel = (ly + th // 2) / max(1, roi.shape[0])
        x_rel = (lx + tw // 2) / max(1, roi.shape[1])
        from_b = 1.0 - y_rel
        log(
            f"点击 {action_cn} 结果=忽略 原因=命中越界 "
            f"分数={score:.2f} 相对xy={x_rel:.2f},{y_rel:.2f} 距底={from_b:.2f}"
        )
        ok_fb = _click_blue_grid_fallback(roi, mon_l, mon_t, x0, y0, action_cn)
        del screen, roi
        return ok_fb
    cx = mon_l + x0 + lx + tw // 2
    cy = mon_t + y0 + ly + th // 2
    if action_cn == "无感换号":
        _click_seamless_at(cx, cy)
    else:
        detect_tip._click_screen(int(cx), int(cy))
    log(
        f"点击 {action_cn} 结果=成功 方式=窗口内模板 "
        f"分数={score:.2f} 坐标={cx},{cy} 标题={title[:40]}"
    )
    del screen, roi
    time.sleep(0.4)
    return True


def _seamless_y_ok(ly: int, th: int, roi_h: int) -> bool:
    """无感换号按距底边比例判定（窗高变化时相对顶会漂，距底更稳）。"""
    fb = getattr(config, "SEAMLESS_HIT_FROM_BOTTOM", (0.10, 0.42))
    cy = ly + th // 2
    from_bottom = (roi_h - cy) / max(1, roi_h)
    return float(fb[0]) <= from_bottom <= float(fb[1])


def _seamless_x_ok(lx: int, tw: int, roi_w: int) -> bool:
    """无感换号在右栏底钮左起第一颗；拒侧栏与「指定路径」。"""
    xmin = float(getattr(config, "SEAMLESS_HIT_X_MIN", 0.45))
    xmax = float(getattr(config, "SEAMLESS_HIT_X_MAX", 0.72))
    cx = (lx + tw // 2) / max(1, roi_w)
    return xmin <= cx <= xmax


def _click_seamless_at(cx: int, cy: int, hwnd: Optional[int] = None) -> None:
    """只点一次硬点击。禁止连点；WebView 不用 pyautogui。"""
    win_util.click_screen_hard(int(cx), int(cy), hwnd=hwnd)


def _expand_ocr_to_blue_btn(
    roi: np.ndarray, lx: int, ly: int, tw: int, th: int
) -> Tuple[int, int, int, int]:
    """
    OCR/模板文字框往往偏右；扩到浅蓝钮连通域，过宽则只取左半（无感|指定 粘连）。
    只扫命中框附近底带，避免整窗连通域拖慢。
    返回 (lx,ly,tw,th)。
    """
    cx0 = lx + max(1, tw) // 2
    cy0 = ly + max(1, th) // 2
    h, w = roi.shape[:2]
    pad_x, pad_y = 80, 50
    x0 = max(0, lx - pad_x)
    y0 = max(0, ly - pad_y)
    x1 = min(w, lx + tw + pad_x + max(tw, 120))
    y1 = min(h, ly + th + pad_y)
    sub = roi[y0:y1, x0:x1]
    if sub.size == 0:
        return lx, ly, tw, th
    hsv = cv2.cvtColor(sub, cv2.COLOR_BGR2HSV)
    mask = (
        (hsv[:, :, 0] >= 90)
        & (hsv[:, :, 0] <= 130)
        & (hsv[:, :, 1] >= 40)
        & (hsv[:, :, 2] >= 130)
    )
    mask_u8 = cv2.morphologyEx(
        (mask.astype(np.uint8) * 255),
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_RECT, (7, 3)),
        iterations=2,
    )
    n, _lab, stats, _c = cv2.connectedComponentsWithStats(mask_u8, 8)
    best = None
    cx_l = cx0 - x0
    cy_l = cy0 - y0
    for i in range(1, n):
        x, y, bw, bh, ar = stats[i]
        if ar < 1500 or bw < 80 or bh < 22 or bh > 100:
            continue
        if x - 8 <= cx_l <= x + bw + 8 and y - 12 <= cy_l <= y + bh + 12:
            best = (ar, x + x0, y + y0, bw, bh)
            break
    if best is None:
        return lx, ly, tw, th
    _ar, x, y, bw, bh = best
    # 两钮粘连：只点左半（无感换号）
    if bw > int(w * 0.28):
        bw = max(tw + 40, bw // 2)
        log(f"管家 蓝钮过宽已取左半 宽={bw}")
    return int(x), int(y), int(bw), int(bh)


def _account_fingerprint(roi: np.ndarray) -> str:
    """从管家 OCR 抽当前账号/切换状态指纹，用于点后验效。"""
    lines = _ocr_manager_lines(roi)
    parts = []
    for text, _sc, _a, _b, _c, _d in lines:
        t = text.strip()
        if "已切换" in t or "切换到" in t:
            parts.append(t[:80])
        if "@" in t or "***" in t or "outlook" in t.lower():
            parts.append(t[:80])
    return " | ".join(parts)


def _ocr_manager_lines(
    roi: np.ndarray,
    *,
    y0: int = 0,
) -> list:
    """管家窗 OCR，返回 [(text, score, lx,ly,rx,by) 相对完整 roi（含 y0 偏移）]。"""
    ocr = detect_tip._get_ocr_engine()
    if ocr is None or roi is None or roi.size == 0:
        return []
    max_w = int(getattr(config, "MANAGER_OCR_MAX_WIDTH", 900))
    scale = 1.0
    work = roi
    if roi.shape[1] > max_w:
        scale = max_w / float(roi.shape[1])
        work = cv2.resize(
            roi,
            (max_w, max(40, int(roi.shape[0] * scale))),
            interpolation=cv2.INTER_AREA,
        )
    try:
        result, _ = ocr(cv2.cvtColor(work, cv2.COLOR_BGR2RGB))
    except Exception as e:
        log(f"管家 OCR异常 {e}")
        return []
    out = []
    for box, text, score in result or []:
        xs = [float(p[0]) for p in box]
        ys = [float(p[1]) for p in box]
        lx = int(min(xs) / scale)
        ly = int(min(ys) / scale) + int(y0)
        rx = int(max(xs) / scale)
        by = int(max(ys) / scale) + int(y0)
        out.append((str(text or ""), float(score), lx, ly, rx, by))
    return out


def _locate_seamless_btn_ocr(
    roi: np.ndarray,
) -> Optional[Tuple[float, int, int, int, int]]:
    """
    OCR 定位底栏大钮「无感换号」。
    只扫窗高下半，避免整窗 OCR 拖到近 10 秒。
    拒侧栏说明/「激活无感换号」开关文案；优先与「指定Cursor路径」同行者。
    返回 (score, lx, ly, tw, th) 相对 roi。
    """
    h = int(roi.shape[0])
    y_off = int(h * float(getattr(config, "SEAMLESS_OCR_Y0_FRAC", 0.48)))
    y_off = max(0, min(h - 40, y_off))
    sub = roi[y_off:, :]
    lines = _ocr_manager_lines(sub, y0=y_off)
    if not lines:
        return None
    path_ys = []
    for text, _sc, lx, ly, rx, by in lines:
        if "指定" in text and "路径" in text:
            path_ys.append((ly + by) // 2)
    seamless = []
    for text, sc, lx, ly, rx, by in lines:
        t = text.replace(" ", "").replace("　", "")
        # 只要短按钮「无感换号」；排除 激活/自动/+无感换号/说明段
        if "无感换号" not in t:
            continue
        if any(bad in t for bad in ("激活", "自动", "功能", "说明", "点击", "Token", "+")):
            continue
        if len(t) > 8:
            continue
        cy = (ly + by) // 2
        if not _seamless_y_ok(ly, max(1, by - ly), roi.shape[0]):
            continue
        if not _seamless_x_ok(lx, max(1, rx - lx), roi.shape[1]):
            continue
        near_path = 0.0
        if path_ys:
            dist = min(abs(cy - py) for py in path_ys)
            if dist <= 45:
                near_path = 0.15
            elif dist > 120:
                # 距「指定路径」过远：多半是侧栏/开关文案误检，仍拒
                continue
        seamless.append(
            (sc + near_path, lx, ly, rx - lx, by - ly, (lx + rx) // 2, cy, text)
        )
    if not seamless:
        return None
    # 同分取更靠下（底栏大钮）
    seamless.sort(key=lambda it: (it[0], it[6]), reverse=True)
    sc, lx, ly, tw, th, _cx, _cy, text = seamless[0]
    log(f"管家 OCR定位 无感换号 文案={text!r} 分数={sc:.2f} 框={lx},{ly},{tw}x{th}")
    return float(min(sc, 1.0)), int(lx), int(ly), int(max(tw, 1)), int(max(th, 1))


def _switch_status_ocr(roi: np.ndarray) -> str:
    """读管家底栏状态：已切换 / 其它。"""
    lines = _ocr_manager_lines(roi)
    for text, _sc, _a, _b, _c, _d in lines:
        if "已切换" in text or "切换到" in text:
            return text.strip()[:60]
    return ""


def _grab_manager_roi(
    hwnd: int,
) -> Optional[Tuple[np.ndarray, int, int, int, int, int, int]]:
    """截管家客户区 ROI。返回 (roi, mon_l, mon_t, x0, y0, ww) 或 None。"""
    rect = win_util.get_rect(hwnd)
    if not rect:
        return None
    wl, wt, wr, wb = rect
    ww, wh = wr - wl, wb - wt
    if ww < 200 or wh < 200:
        return None
    screen, mon_l, mon_t = detect_tip.grab_screen_bgr()
    sh, sw = screen.shape[:2]
    x0 = max(0, min(sw, wl - mon_l))
    y0 = max(0, min(sh, wt - mon_t))
    x1 = max(0, min(sw, wr - mon_l))
    y1 = max(0, min(sh, wb - mon_t))
    if x1 - x0 < 80 or y1 - y0 < 80:
        del screen
        return None
    roi = screen[y0:y1, x0:x1].copy()
    del screen
    return roi, mon_l, mon_t, x0, y0, ww


def _locate_seamless_template(
    roi: np.ndarray, ww: int
) -> Tuple[Optional[Tuple[float, int, int, int, int]], str]:
    """底栏模板匹配「无感换号」（通常比整窗/大半窗 OCR 更快）。"""
    thr = float(getattr(config, "SEAMLESS_SWITCH_THRESHOLD", 0.80))
    h = int(roi.shape[0])
    y_off = int(h * float(getattr(config, "SEAMLESS_OCR_Y0_FRAC", 0.48)))
    y_off = max(0, min(h - 40, y_off))
    sub = roi[y_off:, :]
    for name in ("btn_seamless_switch.png", "btn_seamless_switch_text.png"):
        if not (config.TEMPLATES_DIR / name).is_file():
            continue
        tpl = detect_tip._load_template(name)
        if tpl is None:
            continue
        hit = detect_tip._match_scaled(
            sub, tpl, thr, scales=_manager_match_scales(ww)
        )
        if hit is None:
            continue
        score, lx, ly, tw, th = hit
        ly = ly + y_off
        if _seamless_y_ok(ly, th, roi.shape[0]) and _seamless_x_ok(
            lx, tw, roi.shape[1]
        ):
            return (score, lx, ly, tw, th), f"窗口内模板:{name}"
    return None, ""


def _locate_seamless_any(
    roi: np.ndarray, ww: int
) -> Tuple[Optional[Tuple[float, int, int, int, int]], str]:
    """模板（底栏）→ OCR（底栏）。返回 (loc, way)。优先模板以缩短点前等待。"""
    loc, way = _locate_seamless_template(roi, ww)
    if loc is not None:
        return loc, way
    loc = _locate_seamless_btn_ocr(roi)
    if loc is not None:
        return loc, "OCR"
    return None, ""


def _mark_inject_done() -> None:
    """无感换号已能点到 → 视为注入就绪，后续跳过注入 OCR。"""
    global _inject_clicked_once
    _inject_clicked_once = True
    try:
        config.LOGS_DIR.mkdir(parents=True, exist_ok=True)
        (config.LOGS_DIR / "_inject_done.flag").write_text("1", encoding="utf-8")
    except Exception:
        pass


def _inject_already_done() -> bool:
    global _inject_clicked_once
    if _inject_clicked_once:
        return True
    try:
        if (config.LOGS_DIR / "_inject_done.flag").is_file():
            _inject_clicked_once = True
            return True
    except Exception:
        pass
    return False


def _ensure_inject_if_needed(
    roi: np.ndarray, mon_l: int, mon_t: int, x0: int, y0: int
) -> bool:
    """
    v15.7+ 红字「点击注入启用无感换号」时，先点一次右上「注入」。
    仅在底栏「无感换号」定位失败时才调用（避免每轮/重启后白跑慢 OCR）。
    返回本轮是否刚点了注入。
    """
    if _inject_already_done():
        return False
    h = int(roi.shape[0])
    y1 = int(h * float(getattr(config, "MANAGER_INJECT_OCR_Y1_FRAC", 0.40)))
    y1 = max(40, min(h, y1))
    t_ocr = time.time()
    lines = _ocr_manager_lines(roi[:y1, :], y0=0)
    log(f"管家 注入检测OCR耗时={time.time() - t_ocr:.2f}s 行数={len(lines)}")
    need = False
    inject_box = None
    for text, sc, lx, ly, rx, by in lines:
        t = (text or "").replace(" ", "").replace("　", "")
        if "启用" in t and "无感" in t and "注入" in t:
            need = True
        if t == "注入" or (t.endswith("注入") and len(t) <= 4):
            # 顶栏右侧小钮（拒底栏大文案）
            cy = (ly + by) // 2
            if cy < int(roi.shape[0] * 0.35) and sc >= 0.7:
                inject_box = (lx, ly, rx - lx, by - ly)
    if not need or inject_box is None:
        # 无红字提示：也记为已处理，避免下次再白跑 OCR
        _mark_inject_done()
        return False
    lx, ly, tw, th = inject_box
    cx = mon_l + x0 + lx + tw // 2
    cy = mon_t + y0 + ly + th // 2
    win_util.click_screen_hard(int(cx), int(cy))
    _mark_inject_done()
    log(f"管家 已单击注入一次 坐标={cx},{cy}（启用无感换号）")
    time.sleep(0.55)
    return True


def click_seamless_switch() -> bool:
    """
    前置续杯管家 → 先模板定位「无感换号」→ 硬单击一次 → 立刻返回。
    注入 OCR 仅在模板/底栏 OCR 都找不到按钮时才跑（日志里曾因此白等约 10s）。
    切回 Cursor 由调用方在 SWITCH_WAIT 后再做。
    """
    t0 = time.time()
    hwnd = 0
    clicked_ok = False
    if not focus_manager():
        return False
    time.sleep(float(getattr(config, "SEAMLESS_PRECLICK_WAIT", 0.25)))

    found = find_manager_hwnd()
    if found is None:
        log("点击 无感换号 结果=失败 原因=窗口丢失")
        release_manager_after_switch()
        return False
    hwnd, title = found
    win_util.force_foreground(hwnd, keep_topmost=True)
    time.sleep(0.12)

    grabbed = _grab_manager_roi(hwnd)
    if grabbed is None:
        log("点击 无感换号 结果=失败 原因=截屏ROI无效或窗口过小")
        release_manager_after_switch()
        return False
    roi, mon_l, mon_t, x0, y0, ww = grabbed

    try:
        # 1) 快路径：底栏模板（不动注入 OCR）
        t_loc = time.time()
        loc, way = _locate_seamless_template(roi, ww)
        log(f"管家 模板定位耗时={time.time() - t_loc:.2f}s 命中={'是' if loc else '否'}")

        # 2) 模板空：底栏 OCR（仍不先跑注入）
        if loc is None:
            t_ocr = time.time()
            loc = _locate_seamless_btn_ocr(roi)
            if loc is not None:
                way = "OCR"
            log(
                f"管家 底栏OCR定位耗时={time.time() - t_ocr:.2f}s "
                f"命中={'是' if loc else '否'}"
            )

        # 3) 仍空：再强制置顶重截一次（常因 Cursor 压住导致截到错画面）
        if loc is None:
            just_injected = _ensure_inject_if_needed(roi, mon_l, mon_t, x0, y0)
            wait_r = float(getattr(config, "SEAMLESS_RELOCATE_WAIT", 0.45))
            if just_injected:
                time.sleep(0.25)
            else:
                log(f"管家 无感换号首轮未定位 等待={wait_r:.2f}s后重截")
                time.sleep(max(0.2, wait_r))
            win_util.force_foreground(hwnd, keep_topmost=True)
            win_util.set_topmost(hwnd, True)
            time.sleep(0.2)
            grabbed3 = _grab_manager_roi(hwnd)
            if grabbed3 is not None:
                del roi
                roi, mon_l, mon_t, x0, y0, ww = grabbed3
                loc, way = _locate_seamless_any(roi, ww)

        if loc is not None:
            score, lx, ly, tw, th = loc
            lx, ly, tw, th = _expand_ocr_to_blue_btn(roi, lx, ly, tw, th)
            cx = mon_l + x0 + lx + max(1, int(tw * 0.42))
            cy = mon_t + y0 + ly + th // 2
            _click_seamless_at(cx, cy, hwnd=hwnd)
            _mark_inject_done()
            clicked_ok = True
            log(
                f"点击 无感换号 结果=已单击一次 方式={way}+蓝钮 分数={score:.2f} "
                f"坐标={cx},{cy} 框={lx},{ly},{tw}x{th} "
                f"前置到点击耗时={time.time() - t0:.2f}s 标题={title[:36]}"
            )
            return True

        # 模板+OCR仍空：蓝钮网格兜底（v15.7.5 距底带已放宽）
        if _click_blue_grid_fallback(roi, mon_l, mon_t, x0, y0, "无感换号"):
            _mark_inject_done()
            clicked_ok = True
            log(f"点击 无感换号 蓝钮兜底 前置到点击耗时={time.time() - t0:.2f}s")
            return True

        try:
            dump = config.LOGS_DIR / "_mgr_locate_fail.png"
            cv2.imencode(".png", roi)[1].tofile(str(dump))
            log(f"管家 定位失败已存截图 {dump.name}")
        except Exception:
            pass
        log(
            f"点击 无感换号 结果=失败 原因=OCR与模板与蓝钮均未定位 "
            f"耗时={time.time() - t0:.2f}s 前台={_foreground_title() or '-'}"
        )
        return False
    finally:
        try:
            del roi
        except Exception:
            pass
        # 成功：保持管家置顶 + Cursor 最小化，留给调用方等 3 秒再生效切回
        # 失败：立刻还原，避免 Cursor 一直缩在任务栏
        if not clicked_ok:
            release_manager_after_switch()


def click_reset_machine() -> bool:
    """前置续杯管家，点红色「重置机器码 (Too many free trials)」。"""
    thr = float(getattr(config, "RESET_MACHINE_THRESHOLD", 0.75))
    return _click_template_in_manager("btn_reset_machine.png", "重置机器码", thr)


def wait_and_click_mgr_confirm(
    title_templates: Tuple[str, ...],
    action_cn: str,
    timeout: Optional[float] = None,
) -> bool:
    """
    等管家弹窗标题出现，再点「确定」。
    优先点确定按钮模板；失败则按标题框右下几何点（不点取消）。
    """
    timeout = (
        timeout
        if timeout is not None
        else float(getattr(config, "MGR_CONFIRM_WAIT", 12.0))
    )
    thr = float(getattr(config, "MGR_DIALOG_THRESHOLD", 0.72))
    thr_ok = max(0.68, thr - 0.05)
    deadline = time.time() + timeout
    focus_manager()
    time.sleep(0.35)

    while time.time() < deadline:
        focus_manager()
        found = find_manager_hwnd()
        if not found:
            time.sleep(0.35)
            continue
        hwnd, _title = found
        rect = win_util.get_rect(hwnd)
        if not rect or not win_util.is_onscreen(hwnd):
            time.sleep(0.35)
            continue
        wl, wt, wr, wb = rect
        # 弹窗可能略超出管家客户区，ROI 略放大
        pad = 40
        screen, mon_l, mon_t = detect_tip.grab_screen_bgr()
        sh, sw = screen.shape[:2]
        x0 = max(0, wl - mon_l - pad)
        y0 = max(0, wt - mon_t - pad)
        x1 = min(sw, wr - mon_l + pad)
        y1 = min(sh, wb - mon_t + pad)
        roi = screen[y0:y1, x0:x1]
        ww = wr - wl
        scales = _manager_match_scales(ww)

        hit_t = None
        used_title = ""
        for tn in title_templates:
            tpl = detect_tip._load_template(tn)
            if tpl is None:
                continue
            hit_t = detect_tip._match_scaled(roi, tpl, thr, scales=scales)
            if hit_t is not None:
                used_title = tn
                break
        if hit_t is None:
            del screen, roi
            time.sleep(0.35)
            continue

        score_t, lx, ly, tw, th = hit_t
        # 1) 确定按钮模板（标题下方附近）
        tpl_ok = detect_tip._load_template("btn_mgr_confirm_ok.png")
        if tpl_ok is not None:
            # 只在标题右侧偏下搜，避免点到无感换号
            sx0 = max(0, lx - 20)
            sy0 = max(0, ly)
            sx1 = min(roi.shape[1], lx + tw + 220)
            sy1 = min(roi.shape[0], ly + th + 120)
            if sx1 - sx0 >= 40 and sy1 - sy0 >= 20:
                sub = roi[sy0:sy1, sx0:sx1]
                hit_ok = detect_tip._match_scaled(
                    sub, tpl_ok, thr_ok, scales=scales
                )
                if hit_ok is not None:
                    sc, ox, oy, ow, oh = hit_ok
                    cx = mon_l + x0 + sx0 + ox + ow // 2
                    cy = mon_t + y0 + sy0 + oy + oh // 2
                    detect_tip._click_screen(int(cx), int(cy))
                    log(
                        f"对话框 {action_cn} 结果=已点击 方式=确定模板 "
                        f"标题={used_title} 分数={max(score_t, sc):.2f} "
                        f"坐标={cx},{cy}"
                    )
                    del screen, roi
                    time.sleep(0.5)
                    return True

        # 2) 几何：标题右下方「确定」（取消在左，确定在右）
        cx = mon_l + x0 + lx + tw + 90
        cy = mon_t + y0 + ly + th + 55
        cx = min(max(cx, mon_l + x0 + lx + 40), mon_l + x1 - 12)
        cy = min(max(cy, mon_t + y0 + ly + 20), mon_t + y1 - 12)
        detect_tip._click_screen(int(cx), int(cy))
        log(
            f"对话框 {action_cn} 结果=已点击 方式=几何确定 "
            f"标题={used_title} 分数={score_t:.2f} 坐标={cx},{cy}"
        )
        del screen, roi
        time.sleep(0.5)
        return True

    log(f"对话框 {action_cn} 结果=失败 原因=超时未出现")
    return False


def run_reset_machine_confirms() -> bool:
    """确认重置 → 强制关闭 Cursor，两步都点确定。"""
    ok1 = wait_and_click_mgr_confirm(
        ("dlg_confirm_reset.png",),
        "确认重置",
    )
    if not ok1:
        return False
    time.sleep(0.6)
    ok2 = wait_and_click_mgr_confirm(
        ("dlg_force_close_cursor.png", "dlg_force_close_body.png"),
        "强制关闭Cursor",
    )
    return ok2
