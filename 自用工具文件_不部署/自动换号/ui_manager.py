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
import win_util
from logutil import log

WM_SYSCOMMAND = 0x0112
SC_RESTORE = 0xF120


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


def focus_manager() -> bool:
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
        # 托盘/最小化：先 PostMessage+placement 再置前（仅 force 常拉不回来）
        if win_util.is_iconic(hwnd) or not win_util.is_onscreen(hwnd):
            try:
                ctypes.windll.user32.PostMessageW(hwnd, WM_SYSCOMMAND, SC_RESTORE, 0)
            except Exception:
                pass
            win_util.restore_window_onscreen(hwnd)
            time.sleep(0.45)
        win_util.force_foreground(hwnd)
        time.sleep(0.55)
        if win_util.is_onscreen(hwnd):
            log("管家 前置窗口 结果=成功")
            return True
        win_util.restore_window_onscreen(hwnd)
        win_util.force_foreground(hwnd)
        time.sleep(0.7)
        if win_util.is_onscreen(hwnd):
            log("管家 前置窗口 结果=成功 方式=二次还原")
            return True

    log("管家 前置窗口 结果=失败 原因=未能还原到屏幕上（请先手动打开续杯管家窗口）")
    return False


def _manager_match_scales(ww: int) -> tuple[float, ...]:
    """模板来自整屏约 1024 宽截图；实机管家窗常更宽，多档尺度。"""
    prefer = round(max(0.85, min(2.5, ww / 700.0)), 2)
    ordered: list[float] = []
    for s in (
        prefer,
        prefer - 0.1,
        prefer + 0.1,
        prefer - 0.2,
        prefer + 0.2,
        1.0,
        1.15,
        1.3,
        0.9,
        1.5,
        0.8,
        1.7,
        2.0,
        2.2,
        2.4,
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
    模板失败时：在窗下半找浅蓝大按钮网格，点左上格（无感换号）。
    不点红色「重置机器码」。
    """
    h, w = roi.shape[:2]
    y_cut = int(h * 0.42)
    sub = roi[y_cut:, :, :]
    if sub.size == 0:
        return False
    hsv = cv2.cvtColor(sub, cv2.COLOR_BGR2HSV)
    mask = (
        (hsv[:, :, 0] >= 90)
        & (hsv[:, :, 0] <= 130)
        & (hsv[:, :, 1] >= 50)
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
        if ar < 1200 or bw < 80 or bh < 16 or bh > 70:
            continue
        # 排除偏红（重置钮）
        patch = sub[y : y + bh, x : x + bw]
        mean = patch.mean(axis=(0, 1))
        if mean[2] + 25 < mean[0]:  # BGR: 红通道明显高于蓝 → 跳过
            continue
        if mean[0] > mean[2] + 15:  # 偏红
            continue
        cands.append((y, x, bw, bh, ar))
    if not cands:
        return False
    # 左上：先按 y 再按 x
    cands.sort(key=lambda t: (t[0], t[1]))
    y, x, bw, bh, _ar = cands[0]
    cx = mon_l + x0 + x + bw // 2
    cy = mon_t + y0 + y_cut + y + bh // 2
    detect_tip._click_screen(int(cx), int(cy))
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
        # 近失够高则直接点（换号按钮文案固定，误点风险低于「永远点不到」）
        soft_ok = float(getattr(config, "SEAMLESS_SWITCH_SOFT_OK", 0.68))
        if (
            action_cn == "无感换号"
            and soft is not None
            and soft[0] >= soft_ok
        ):
            score, lx, ly, tw, th = soft
            cx = mon_l + x0 + lx + tw // 2
            cy = mon_t + y0 + ly + th // 2
            detect_tip._click_screen(int(cx), int(cy))
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
    cx = mon_l + x0 + lx + tw // 2
    cy = mon_t + y0 + ly + th // 2
    detect_tip._click_screen(int(cx), int(cy))
    log(
        f"点击 {action_cn} 结果=成功 方式=窗口内模板 "
        f"分数={score:.2f} 坐标={cx},{cy} 标题={title[:40]}"
    )
    del screen, roi
    time.sleep(0.4)
    return True


def click_seamless_switch() -> bool:
    """前置续杯管家，点「无感换号」。"""
    thr = float(getattr(config, "SEAMLESS_SWITCH_THRESHOLD", 0.74))
    return _click_template_in_manager("btn_seamless_switch.png", "无感换号", thr)


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
