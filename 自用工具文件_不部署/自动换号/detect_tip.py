# -*- coding: utf-8 -*-
"""截图 + 模板匹配：检测两种 tip，并点击关闭。"""
from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Tuple

import cv2
import mss
import numpy as np
from PIL import Image

import config
from logutil import log

TipKind = str  # usage_limit | error_resume


@dataclass
class TipHit:
    kind: TipKind
    # 全屏绝对坐标（左上、右下）
    left: int
    top: int
    right: int
    bottom: int
    score: float


def _imread_unicode(path: Path) -> Optional[np.ndarray]:
    """OpenCV 无法直接读中文路径，经 Pillow 转 BGR。"""
    try:
        im = Image.open(path).convert("RGB")
        return cv2.cvtColor(np.array(im), cv2.COLOR_RGB2BGR)
    except Exception:
        return None


def _load_template(name: str) -> Optional[np.ndarray]:
    return _imread_unicode(config.TEMPLATES_DIR / name)


def grab_screen_bgr() -> Tuple[np.ndarray, int, int]:
    """抓主屏，返回 BGR 图与虚拟屏左上偏移。"""
    with mss.mss() as sct:
        mon = sct.monitors[1]  # 主显示器
        shot = sct.grab(mon)
        # mss: BGRA
        bgra = np.array(shot, dtype=np.uint8)
        bgr = bgra[:, :, :3].copy()
        return bgr, int(mon["left"]), int(mon["top"])


def _roi_rect(h: int, w: int) -> Tuple[int, int, int, int]:
    l, t, r, b = config.TIP_ROI_REL
    return int(w * l), int(h * t), int(w * r), int(h * b)


def _match_y_in_band(
    ly: int,
    th: int,
    y0: int,
    screen_h: int,
    band: Tuple[float, float],
) -> bool:
    """命中框纵向中心是否落在指定屏高比例带内（排除 chat 历史误匹配）。"""
    center_y = y0 + ly + th / 2.0
    rel = center_y / max(screen_h, 1)
    return band[0] <= rel <= band[1]


def _has_conn_icon_near(
    roi: np.ndarray,
    lx: int,
    ly: int,
    th: int,
) -> bool:
    """Connection Error 卡片左侧应有黄色警示图标。"""
    tpl_icon = _load_template("tip_conn_icon.png")
    if tpl_icon is None:
        return True
    sl = max(0, lx - 70)
    st = max(0, ly - 8)
    sr = min(roi.shape[1], lx + 15)
    sb = min(roi.shape[0], ly + th + 8)
    if sb - st < 10 or sr - sl < 10:
        return False
    sub = roi[st:sb, sl:sr]
    return _match_in(sub, tpl_icon, config.CONN_ICON_MIN_SCORE) is not None


def _detect_connection_error(
    roi: np.ndarray,
    mon_l: int,
    mon_t: int,
    x0: int,
    y0: int,
    screen_h: int,
    conn_thr: float,
) -> Optional[TipHit]:
    """
    Connection Error 须满足位置带；优先整卡，其次标题+正文共现。
    禁止单独用 unlimited Tab 正文（chat 历史里常有同类英文）。
    """
    band = config.CONN_TOAST_Y_BAND
    tpl_toast = _load_template("tip_conn_toast.png")
    hit = _match_in(roi, tpl_toast, max(conn_thr, 0.74))
    if hit:
        score, lx, ly = hit
        th, tw = tpl_toast.shape[:2]
        if _match_y_in_band(ly, th, y0, screen_h, band):
            if score >= 0.88 or _has_conn_icon_near(roi, lx, ly, th):
                return TipHit(
                    kind="connection_error",
                    left=mon_l + x0 + lx,
                    top=mon_t + y0 + ly,
                    right=mon_l + x0 + lx + tw,
                    bottom=mon_t + y0 + ly + th,
                    score=score,
                )

    tpl_title = _load_template("tip_connection_error.png")
    tpl_body = _load_template("tip_unlimited_tab.png")
    hit_t = _match_in(roi, tpl_title, max(conn_thr, 0.72))
    hit_b = _match_in(roi, tpl_body, config.CONN_BODY_ONLY_THRESHOLD)
    if hit_t and hit_b:
        score_t, lx_t, ly_t = hit_t
        score_b, lx_b, ly_b = hit_b
        th_t, tw_t = tpl_title.shape[:2]
        th_b, tw_b = tpl_body.shape[:2]
        # 标题应略高于正文，且二者纵向中心都在 toast 带内
        if ly_t + th_t <= ly_b + 30 and abs(lx_t - lx_b) < 120:
            if _match_y_in_band(ly_t, th_t, y0, screen_h, band) and _match_y_in_band(
                ly_b, th_b, y0, screen_h, band
            ):
                if _has_conn_icon_near(roi, min(lx_t, lx_b), min(ly_t, ly_b), th_t + th_b):
                    score = max(score_t, score_b)
                    l = min(x0 + lx_t, x0 + lx_b)
                    t = min(y0 + ly_t, y0 + ly_b)
                    r = max(x0 + lx_t + tw_t, x0 + lx_b + tw_b)
                    b = max(y0 + ly_t + th_t, y0 + ly_b + th_b)
                    return TipHit(
                        kind="connection_error",
                        left=mon_l + l,
                        top=mon_t + t,
                        right=mon_l + r,
                        bottom=mon_t + b,
                        score=score,
                    )
    return None


def _detect_usage_limit(
    roi: np.ndarray,
    mon_l: int,
    mon_t: int,
    x0: int,
    y0: int,
    screen_h: int,
    thr: float,
) -> Optional[TipHit]:
    """
    用量上限 toast 在 chat 输入框上方；禁止单独匹配 Upgrade 按钮（易与顶栏 Upgrade to Pro 混淆）。
    """
    band = config.CHAT_TOAST_Y_BAND
    tpl_toast = _load_template("tip_usage_toast.png")
    hit = _match_in(roi, tpl_toast, max(thr, 0.78))
    if hit:
        score, lx, ly = hit
        th, tw = tpl_toast.shape[:2]
        if _match_y_in_band(ly, th, y0, screen_h, band):
            return TipHit(
                kind="usage_limit",
                left=mon_l + x0 + lx,
                top=mon_t + y0 + ly,
                right=mon_l + x0 + lx + tw,
                bottom=mon_t + y0 + ly + th,
                score=score,
            )

    tpl_usage = _load_template("tip_usage_limit.png")
    tpl_upgrade = _load_template("tip_upgrade_btn.png")
    hit_u = _match_in(roi, tpl_usage, max(thr, 0.82))
    hit_up = _match_in(roi, tpl_upgrade, max(thr, 0.85))
    if hit_u and hit_up:
        score_u, lx_u, ly_u = hit_u
        score_up, lx_up, ly_up = hit_up
        th_u, tw_u = tpl_usage.shape[:2]
        th_up, tw_up = tpl_upgrade.shape[:2]
        # Upgrade 按钮在标题行右侧，与用量文案垂直接近
        if abs(ly_u - ly_up) < 40 and lx_up > lx_u - 20:
            if _match_y_in_band(ly_u, th_u, y0, screen_h, band):
                score = max(score_u, score_up)
                l = min(x0 + lx_u, x0 + lx_up)
                t = min(y0 + ly_u, y0 + ly_up)
                r = max(x0 + lx_u + tw_u, x0 + lx_up + tw_up)
                b = max(y0 + ly_u + th_u, y0 + ly_up + th_up)
                return TipHit(
                    kind="usage_limit",
                    left=mon_l + l,
                    top=mon_t + t,
                    right=mon_l + r,
                    bottom=mon_t + b,
                    score=score,
                )
    return None


def _match_in(
    hay: np.ndarray,
    needle: np.ndarray,
    threshold: float,
) -> Optional[Tuple[float, int, int]]:
    if needle is None or hay is None:
        return None
    if needle.shape[0] >= hay.shape[0] or needle.shape[1] >= hay.shape[1]:
        return None
    res = cv2.matchTemplate(hay, needle, cv2.TM_CCOEFF_NORMED)
    _min_v, max_v, _min_l, max_l = cv2.minMaxLoc(res)
    if max_v < threshold:
        return None
    return float(max_v), int(max_l[0]), int(max_l[1])


def detect_tip(threshold: Optional[float] = None) -> Optional[TipHit]:
    """
    在主屏右下 ROI 检测 tip。
    顺序：恢复会话失败 → Connection Error → 用量上限。
    """
    thr = threshold if threshold is not None else config.TIP_MATCH_THRESHOLD
    screen, mon_l, mon_t = grab_screen_bgr()
    h, w = screen.shape[:2]
    x0, y0, x1, y1 = _roi_rect(h, w)
    roi = screen[y0:y1, x0:x1]

    tpl_err = _load_template("tip_error_resume.png")
    tpl_err_alt = _load_template("tip_error_resume_alt.png")

    # 1) 恢复会话失败（须在 chat toast 带内，避免误匹配其它 UI）
    band = config.CHAT_TOAST_Y_BAND
    for tpl in (tpl_err, tpl_err_alt):
        hit = _match_in(roi, tpl, thr)
        if hit:
            score, lx, ly = hit
            th, tw = tpl.shape[:2]
            if _match_y_in_band(ly, th, y0, h, band):
                return TipHit(
                    kind="error_resume",
                    left=mon_l + x0 + lx,
                    top=mon_t + y0 + ly,
                    right=mon_l + x0 + lx + tw,
                    bottom=mon_t + y0 + ly + th,
                    score=score,
                )

    # 2) Connection Error（位置带 + 整卡/标题正文共现，避免 chat 历史误报）
    conn_thr = min(thr, 0.72)
    conn_hit = _detect_connection_error(roi, mon_l, mon_t, x0, y0, h, conn_thr)
    if conn_hit is not None:
        return conn_hit

    # 3) 用量上限（禁止单独 Upgrade 按钮）
    usage_hit = _detect_usage_limit(roi, mon_l, mon_t, x0, y0, h, thr)
    if usage_hit is not None:
        return usage_hit
    return None


def _tip_close_xy_from_box(
    tip_box: Tuple[int, int, int, int],
    mon_l: int,
    mon_t: int,
    kind: str,
    matched_name: str,
) -> Tuple[int, int]:
    """
    Connection Error tip 的 × 极浅，模板易假阳；按命中框几何点右上角。
    tip_conn_toast 是整卡；正文/标题模板偏下偏左，需上移右移。
    """
    l, t, r, b = tip_box
    if matched_name == "tip_conn_toast.png":
        cx = mon_l + r - 20
        cy = mon_t + t + 16
    elif matched_name in ("tip_unlimited_tab.png", "tip_connection_error.png"):
        # 正文/标题在卡片中下部：× 约在其右上方
        cx = mon_l + r + 45
        cy = mon_t + t - 42
    else:
        cx = mon_l + r - 18
        cy = mon_t + t + 12
        if kind == "usage_limit":
            cx = mon_l + r - 22
            cy = mon_t + t + 14
    return int(cx), int(cy)


def _find_post_open_tip_box(
    roi: np.ndarray,
    x0: int,
    y0: int,
    screen_h: int,
) -> Optional[Tuple[Tuple[int, int, int, int], str, str, float]]:
    """打开工程后清 tip：返回 (tip_box, kind, matched_name, score)。"""
    tpl_toast = _load_template("tip_conn_toast.png")
    hit = _match_in(roi, tpl_toast, 0.74)
    if hit:
        score, lx, ly = hit
        th, tw = tpl_toast.shape[:2]
        if _match_y_in_band(ly, th, y0, screen_h, config.CONN_TOAST_Y_BAND):
            if score >= 0.88 or _has_conn_icon_near(roi, lx, ly, th):
                box = (x0 + lx, y0 + ly, x0 + lx + tw, y0 + ly + th)
                return box, "connection_error", "tip_conn_toast.png", score

    tpl_title = _load_template("tip_connection_error.png")
    tpl_body = _load_template("tip_unlimited_tab.png")
    hit_t = _match_in(roi, tpl_title, 0.72)
    hit_b = _match_in(roi, tpl_body, config.CONN_BODY_ONLY_THRESHOLD)
    if hit_t and hit_b:
        score_t, lx_t, ly_t = hit_t
        score_b, lx_b, ly_b = hit_b
        th_t, tw_t = tpl_title.shape[:2]
        th_b, tw_b = tpl_body.shape[:2]
        if ly_t + th_t <= ly_b + 30 and abs(lx_t - lx_b) < 120:
            if _match_y_in_band(ly_t, th_t, y0, screen_h, config.CONN_TOAST_Y_BAND):
                if _has_conn_icon_near(roi, min(lx_t, lx_b), min(ly_t, ly_b), th_t + th_b):
                    l = min(x0 + lx_t, x0 + lx_b)
                    t = min(y0 + ly_t, y0 + ly_b)
                    r = max(x0 + lx_t + tw_t, x0 + lx_b + tw_b)
                    b = max(y0 + ly_t + th_t, y0 + ly_b + th_b)
                    return (
                        (l, t, r, b),
                        "connection_error",
                        "tip_connection_error.png",
                        max(score_t, score_b),
                    )

    for name, kind, thr in (
        ("tip_usage_toast.png", "usage_limit", 0.78),
        ("tip_error_resume.png", "error_resume", 0.78),
    ):
        tpl = _load_template(name)
        hit_u = _match_in(roi, tpl, thr)
        if hit_u:
            score, lx, ly = hit_u
            th, tw = tpl.shape[:2]
            band = (
                config.CONN_TOAST_Y_BAND
                if kind == "connection_error"
                else config.CHAT_TOAST_Y_BAND
            )
            if not _match_y_in_band(ly, th, y0, screen_h, band):
                continue
            box = (x0 + lx, y0 + ly, x0 + lx + tw, y0 + ly + th)
            return box, kind, name, score

    usage = _detect_usage_limit(roi, 0, 0, x0, y0, screen_h, 0.78)
    if usage is not None:
        box = (
            usage.left,
            usage.top,
            usage.right,
            usage.bottom,
        )
        return box, "usage_limit", "tip_usage_limit.png", usage.score
    return None


def close_post_open_tips(max_rounds: int = 5) -> str:
    """
    打开工程并最大化后：关掉右下角 chat 区 tip（Connection Error / 用量提示等）。
    优先匹配整卡/正文，再按几何点 ×（不用易假阳的全白 × 模板扫全 ROI）。
    tip 可能晚于最大化出现，故多轮并短暂等待。
    """
    results = []
    for _round in range(max_rounds):
        if _round > 0:
            time.sleep(0.7)
        screen, mon_l, mon_t = grab_screen_bgr()
        h, w = screen.shape[:2]
        l, t, r, b = config.POST_OPEN_TIP_ROI
        x0, y0 = int(w * l), int(h * t)
        x1, y1 = int(w * r), int(h * b)
        roi = screen[y0:y1, x0:x1]

        tip_box = None
        tip_kind = "chat_toast"
        matched_name = ""
        found = _find_post_open_tip_box(roi, x0, y0, h)
        if found:
            tip_box, tip_kind, matched_name, score = found
            log(
                f"打开后清提示 检出={config.TIP_TYPE_CN.get(tip_kind, tip_kind)} "
                f"模板={matched_name} 分数={score:.2f}"
            )

        if tip_box is None:
            continue

        cx, cy = _tip_close_xy_from_box(tip_box, mon_l, mon_t, tip_kind, matched_name)
        # 限制在 chat ROI 内，避免点到 Origin 或标题栏
        if not (x0 <= cx - mon_l <= x1 and y0 <= cy - mon_t <= y1):
            cx = mon_l + tip_box[2] - 18
            cy = mon_t + tip_box[1] + 12
            log(f"打开后清提示 几何点越界已回退 坐标={cx},{cy}")

        try:
            _click_screen(int(cx), int(cy))
            time.sleep(0.5)
            cn = config.TIP_TYPE_CN.get(tip_kind, tip_kind)
            results.append(f"已关闭_{cn}")
            log(f"打开后清提示 点击关闭 坐标={cx},{cy}")
            # tip 已消失则结束；仍在则继续下一轮
            still = detect_tip(threshold=0.70)
            if still is None:
                break
        except Exception as e:
            log(f"错误 打开后关提示失败 {e}")
            results.append("失败")
            break

    if not results:
        return "跳过"
    return "+".join(results)


def _click_screen(x: int, y: int) -> None:
    import pyautogui

    pyautogui.FAILSAFE = False
    pyautogui.click(x, y)


def close_tip(hit: Optional[TipHit] = None) -> str:
    """
    关闭 tip。返回中文结果：已关闭_… / 跳过 / 失败 / 无效（点了但仍检出）。
    """
    if hit is None:
        hit = detect_tip()
    if hit is None:
        return "跳过"

    screen, mon_l, mon_t = grab_screen_bgr()
    h, w = screen.shape[:2]
    tpl_x = _load_template("tip_close_x.png")
    tpl_toast = _load_template("tip_usage_toast.png")

    # 优先用整块 toast 定右上角，比标题条更准
    toast_box = None
    if hit.kind == "usage_limit" and tpl_toast is not None:
        x0, y0, x1, y1 = _roi_rect(h, w)
        roi_full = screen[y0:y1, x0:x1]
        m_toast = _match_in(roi_full, tpl_toast, max(0.72, config.TIP_MATCH_THRESHOLD - 0.08))
        if m_toast:
            sc, lx, ly = m_toast
            th, tw = tpl_toast.shape[:2]
            toast_box = (
                mon_l + x0 + lx,
                mon_t + y0 + ly,
                mon_l + x0 + lx + tw,
                mon_t + y0 + ly + th,
            )

    # Connection Error：白底浅灰 ×，直接用几何点，避免 × 模板假阳
    if hit.kind == "connection_error":
        tw = hit.right - hit.left
        th = hit.bottom - hit.top
        if tw >= 400 and th >= 80:
            matched = "tip_conn_toast.png"
        else:
            matched = "tip_unlimited_tab.png"
        tip_box = (hit.left - mon_l, hit.top - mon_t, hit.right - mon_l, hit.bottom - mon_t)
        cx, cy = _tip_close_xy_from_box(tip_box, mon_l, mon_t, hit.kind, matched)
    else:
        if toast_box:
            search_l = max(0, toast_box[0] - mon_l + int((toast_box[2] - toast_box[0]) * 0.75))
            search_t = max(0, toast_box[1] - mon_t - 8)
            search_r = min(w, toast_box[2] - mon_l + 20)
            search_b = min(h, toast_box[1] - mon_t + 50)
        else:
            search_l = max(0, hit.left - mon_l - 20)
            search_t = max(0, hit.top - mon_t - 30)
            search_r = min(w, hit.right - mon_l + 120)
            search_b = min(h, hit.bottom - mon_t + 80)
            if hit.kind == "usage_limit":
                search_r = min(w, max(search_r, hit.left - mon_l + 900))
                search_t = max(0, hit.top - mon_t - 40)
                search_b = min(h, hit.top - mon_t + 80)

        roi = screen[search_t:search_b, search_l:search_r]
        cx = cy = None
        if tpl_x is not None and roi.size > 0:
            m = _match_in(roi, tpl_x, 0.68)
            if m:
                _score, lx, ly = m
                th, tw = tpl_x.shape[:2]
                cx = mon_l + search_l + lx + tw // 2
                cy = mon_t + search_t + ly + th // 2

        if cx is None:
            ox, oy = config.TIP_CLOSE_OFFSET
            if toast_box:
                cx = toast_box[2] - ox - 8
                cy = toast_box[1] + oy + 4
            else:
                cx = hit.right - ox
                cy = hit.top + oy
                if hit.kind == "usage_limit":
                    # 标题模板偏左：× 约在 Upgrade 按钮上方
                    cx = hit.left + 820
                    cy = hit.top - 10

    try:
        _click_screen(int(cx), int(cy))
        time.sleep(0.35)
        still = detect_tip()
        cn = config.TIP_TYPE_CN.get(hit.kind, hit.kind)
        if still is not None and still.kind == hit.kind:
            # 再试 toast 右上角硬点一次
            if toast_box:
                _click_screen(int(toast_box[2] - 18), int(toast_box[1] + 14))
                time.sleep(0.35)
                still = detect_tip()
            if still is not None and still.kind == hit.kind:
                return "无效"
        return f"已关闭_{cn}"
    except Exception as e:
        log(f"错误 关闭提示失败 {e}")
        return "失败"


def match_template_on_screen(
    template_name: str,
    threshold: Optional[float] = None,
    roi_rel: Optional[Tuple[float, float, float, float]] = None,
) -> Optional[Tuple[int, int, int, int, float]]:
    """
    全屏（或相对 ROI）匹配模板。
    返回 (left, top, right, bottom, score) 绝对坐标；未命中返回 None。
    """
    thr = threshold if threshold is not None else config.MATCH_THRESHOLD
    tpl = _load_template(template_name)
    if tpl is None:
        return None
    screen, mon_l, mon_t = grab_screen_bgr()
    h, w = screen.shape[:2]
    if roi_rel:
        l, t, r, b = roi_rel
        x0, y0, x1, y1 = int(w * l), int(h * t), int(w * r), int(h * b)
    else:
        x0, y0, x1, y1 = 0, 0, w, h
    roi = screen[y0:y1, x0:x1]
    hit = _match_in(roi, tpl, thr)
    if not hit:
        return None
    score, lx, ly = hit
    th, tw = tpl.shape[:2]
    left = mon_l + x0 + lx
    top = mon_t + y0 + ly
    return left, top, left + tw, top + th, score


def click_template(
    template_name: str,
    threshold: Optional[float] = None,
    roi_rel: Optional[Tuple[float, float, float, float]] = None,
) -> bool:
    box = match_template_on_screen(template_name, threshold, roi_rel)
    if not box:
        return False
    l, t, r, b, _ = box
    _click_screen((l + r) // 2, (t + b) // 2)
    return True


def match_template_in_abs_rect(
    template_name: str,
    abs_rect: Tuple[int, int, int, int],
    threshold: Optional[float] = None,
) -> Optional[Tuple[int, int, int, int, float]]:
    """
    仅在屏幕绝对矩形内匹配（助手窗口客户区），避免点到编辑器里打开的参考截图。
    abs_rect = (left, top, right, bottom)，与 GetWindowRect 同坐标系。
    """
    thr = threshold if threshold is not None else config.MATCH_THRESHOLD
    tpl = _load_template(template_name)
    if tpl is None:
        return None
    screen, mon_l, mon_t = grab_screen_bgr()
    h, w = screen.shape[:2]
    al, at, ar, ab = abs_rect
    x0 = max(0, min(w, al - mon_l))
    y0 = max(0, min(h, at - mon_t))
    x1 = max(0, min(w, ar - mon_l))
    y1 = max(0, min(h, ab - mon_t))
    if x1 - x0 < 20 or y1 - y0 < 20:
        return None
    roi = screen[y0:y1, x0:x1]
    hit = _match_in(roi, tpl, thr)
    if not hit:
        return None
    score, lx, ly = hit
    th, tw = tpl.shape[:2]
    left = mon_l + x0 + lx
    top = mon_t + y0 + ly
    return left, top, left + tw, top + th, score


def click_template_in_abs_rect(
    template_name: str,
    abs_rect: Tuple[int, int, int, int],
    threshold: Optional[float] = None,
) -> bool:
    box = match_template_in_abs_rect(template_name, abs_rect, threshold)
    if not box:
        return False
    l, t, r, b, _ = box
    _click_screen((l + r) // 2, (t + b) // 2)
    return True
