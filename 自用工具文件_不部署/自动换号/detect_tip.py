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
from PIL import Image, ImageGrab

import config
from logutil import log

TipKind = str  # usage_limit | error_resume

# 模板内存缓存（路径含中文，避免每轮 Pillow/解码）
_TEMPLATE_CACHE: dict[str, Optional[np.ndarray]] = {}
# 复用 mss 实例，减少反复创建
_MSS = None
# RapidOCR 单例（用量 tip 主路径：读文字，不靠死模板）
_OCR_ENGINE = None
_OCR_LOAD_TRIED = False


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
        arr = np.asarray(im, dtype=np.uint8)
        return cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
    except Exception:
        return None


def _load_template(name: str) -> Optional[np.ndarray]:
    if name in _TEMPLATE_CACHE:
        return _TEMPLATE_CACHE[name]
    img = _imread_unicode(config.TEMPLATES_DIR / name)
    _TEMPLATE_CACHE[name] = img
    return img


def clear_template_cache() -> None:
    """热更新 templates 后可调用；正常监控不必。"""
    _TEMPLATE_CACHE.clear()


def grab_screen_bgr() -> Tuple[np.ndarray, int, int]:
    """抓主屏，返回 BGR 图与虚拟屏左上偏移。BitBlt 失败时重建 mss / 回退 PIL。"""
    global _MSS

    def _from_mss() -> Tuple[np.ndarray, int, int]:
        global _MSS
        if _MSS is None:
            _MSS = mss.mss()
        mon = _MSS.monitors[1]  # 主显示器
        shot = _MSS.grab(mon)
        bgra = np.asarray(shot, dtype=np.uint8)
        bgr = np.ascontiguousarray(bgra[:, :, :3])
        return bgr, int(mon["left"]), int(mon["top"])

    def _reset_mss() -> None:
        global _MSS
        try:
            if _MSS is not None:
                _MSS.close()
        except Exception:
            pass
        _MSS = None

    def _from_pil() -> Tuple[np.ndarray, int, int]:
        # 与 mss 主屏对齐：优先 monitors[1] 区域
        left = top = 0
        try:
            with mss.mss() as sct:
                mon = sct.monitors[1]
                left, top = int(mon["left"]), int(mon["top"])
                box = (
                    left,
                    top,
                    left + int(mon["width"]),
                    top + int(mon["height"]),
                )
                im = ImageGrab.grab(bbox=box) if left or top else ImageGrab.grab()
        except Exception:
            im = ImageGrab.grab()
        rgb = np.asarray(im.convert("RGB"), dtype=np.uint8)
        bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
        return bgr, left, top

    last_err: Optional[Exception] = None
    for attempt in range(3):
        try:
            return _from_mss()
        except Exception as e:
            last_err = e
            _reset_mss()
            time.sleep(0.15 + attempt * 0.1)
            try:
                return _from_mss()
            except Exception as e2:
                last_err = e2
                _reset_mss()
                time.sleep(0.2)
    # mss 连续失败：PIL 回退（日志由调用方可见异常信息时再记）
    try:
        return _from_pil()
    except Exception:
        if last_err is not None:
            raise last_err
        raise


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
    """Connection Error 卡片左侧应有警示图标（黄/灰三角均可）。"""
    tpl_icon = _load_template("tip_conn_icon.png")
    if tpl_icon is None:
        return True
    sl = max(0, lx - 80)
    st = max(0, ly - 12)
    sr = min(roi.shape[1], lx + 40)
    sb = min(roi.shape[0], ly + th + 12)
    if sb - st < 10 or sr - sl < 10:
        return False
    sub = roi[st:sb, sl:sr]
    return _match_scaled(sub, tpl_icon, config.CONN_ICON_MIN_SCORE) is not None


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
    Connection Error：位置带内优先整卡；其次标题+正文；再次高分标题。
    禁止单独用 unlimited Tab 正文（chat 历史里常有同类英文）。
    """
    band = config.CONN_TOAST_Y_BAND
    tpl_toast = _load_template("tip_conn_toast.png")
    hit = _match_scaled(roi, tpl_toast, max(conn_thr, 0.70))
    if hit:
        score, lx, ly, tw, th = hit
        if _match_y_in_band(ly, th, y0, screen_h, band):
            if score >= 0.82 or _has_conn_icon_near(roi, lx, ly, th):
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
    hit_t = _match_scaled(roi, tpl_title, max(conn_thr, 0.72))
    hit_b = _match_scaled(roi, tpl_body, config.CONN_BODY_ONLY_THRESHOLD)
    if hit_t and hit_b:
        score_t, lx_t, ly_t, tw_t, th_t = hit_t
        score_b, lx_b, ly_b, tw_b, th_b = hit_b
        # 标题应略高于正文，横向大致对齐
        if ly_t + th_t <= ly_b + 40 and abs(lx_t - lx_b) < 160:
            if _match_y_in_band(ly_t, th_t, y0, screen_h, band) and _match_y_in_band(
                ly_b, th_b, y0, screen_h, band
            ):
                score = max(score_t, score_b)
                # 双模板高分时可免图标；低分仍要求图标共现
                if score >= 0.86 or _has_conn_icon_near(
                    roi, min(lx_t, lx_b), min(ly_t, ly_b), th_t + th_b
                ):
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

    # 标题单独高分（新模板「Connection Error」足够独特）
    if hit_t:
        score_t, lx_t, ly_t, tw_t, th_t = hit_t
        if score_t >= 0.88 and _match_y_in_band(ly_t, th_t, y0, screen_h, band):
            return TipHit(
                kind="connection_error",
                left=mon_l + x0 + lx_t,
                top=mon_t + y0 + ly_t,
                right=mon_l + x0 + lx_t + tw_t,
                bottom=mon_t + y0 + ly_t + th_t,
                score=score_t,
            )
    return None


def _get_ocr_engine():
    """懒加载 RapidOCR；失败则返回 None（回退模板）。"""
    global _OCR_ENGINE, _OCR_LOAD_TRIED
    if _OCR_ENGINE is not None:
        return _OCR_ENGINE
    if _OCR_LOAD_TRIED:
        return None
    _OCR_LOAD_TRIED = True
    try:
        from rapidocr_onnxruntime import RapidOCR

        _OCR_ENGINE = RapidOCR()
        log("检测 OCR引擎=RapidOCR 已加载（用量tip主路径）")
        return _OCR_ENGINE
    except Exception as e:
        log(f"检测 OCR引擎加载失败 将回退模板 {e}")
        return None


def _classify_usage_ocr_line(text: str) -> Optional[str]:
    """
    语义分类 OCR 行：title / body / upgrade。
    容忍空格、轻微识别误差（如 Upgrade toPo）。
    """
    t = (text or "").lower().strip()
    if not t:
        return None
    compact = "".join(ch for ch in t if ch.isalnum())
    if (
        "usagelimit" in compact
        or "hityourusage" in compact
        or "youvehit" in compact
        or "you've hit" in t
        or "hit your usage" in t
        or "usage limit" in t
    ):
        return "title"
    if "upgrade" in t and "pro" in t:
        return "upgrade"
    if ("unlimited" in t and "tab" in t) or (
        "cursor pro" in t and ("agent" in t or "usage" in t)
    ):
        return "body"
    if "get cursor pro" in t or "more agent usage" in t:
        return "body"
    return None


def _detect_usage_limit_ocr(
    roi: np.ndarray,
    mon_l: int,
    mon_t: int,
    x0: int,
    y0: int,
    screen_h: int,
) -> Optional[TipHit]:
    """
    用量 tip 智能检测：对 chat 右下 ROI 做 OCR，按文案语义判定。
    UI 微调（字号/阴影/按钮圆角）不再依赖像素模板。
    """
    ocr = _get_ocr_engine()
    if ocr is None or roi is None or roi.size == 0:
        return None
    band = config.CHAT_TOAST_Y_BAND
    # 只扫 ROI 中下部（toast 带），并缩到合适宽度加速
    y_off = int(roi.shape[0] * float(getattr(config, "USAGE_OCR_Y_CROP", 0.20)))
    sub = roi[y_off:, :]
    if sub.shape[0] < 40 or sub.shape[1] < 80:
        return None
    max_w = int(getattr(config, "USAGE_OCR_MAX_WIDTH", 960))
    scale = 1.0
    work = sub
    if sub.shape[1] > max_w:
        scale = max_w / float(sub.shape[1])
        work = cv2.resize(
            sub,
            (max_w, max(40, int(sub.shape[0] * scale))),
            interpolation=cv2.INTER_AREA,
        )
    try:
        result, _elapse = ocr(cv2.cvtColor(work, cv2.COLOR_BGR2RGB))
    except Exception as e:
        log(f"检测 OCR异常 {e}")
        return None
    if not result:
        return None

    parts: dict[str, list] = {"title": [], "body": [], "upgrade": []}
    for box, text, score in result:
        kind = _classify_usage_ocr_line(text)
        if kind is None:
            continue
        xs = [float(p[0]) for p in box]
        ys = [float(p[1]) for p in box]
        # 还原到 roi 坐标
        lx = int(min(xs) / scale)
        ly = int(min(ys) / scale) + y_off
        rx = int(max(xs) / scale)
        by = int(max(ys) / scale) + y_off
        parts[kind].append((float(score), lx, ly, rx, by, text))

    if not parts["title"] and not (parts["body"] and parts["upgrade"]):
        # 仅有 upgrade 文案不够（顶栏也可能有 Upgrade to Pro）
        return None
    if not parts["title"] and not parts["body"]:
        return None

    # 取标题优先，否则 body+upgrade 并集
    boxes = parts["title"] or (parts["body"] + parts["upgrade"])
    if parts["title"] and parts["upgrade"]:
        boxes = parts["title"] + parts["upgrade"]
    elif parts["title"] and parts["body"]:
        boxes = parts["title"] + parts["body"]

    score = max(b[0] for b in boxes)
    lx = min(b[1] for b in boxes)
    ly = min(b[2] for b in boxes)
    rx = max(b[3] for b in boxes)
    by = max(b[4] for b in boxes)
    th = max(1, by - ly)
    if not _match_y_in_band(ly, th, y0, screen_h, band):
        return None

    # 证据串便于日志
    evidence = []
    for k in ("title", "body", "upgrade"):
        for _sc, _a, _b, _c, _d, tx in parts[k][:1]:
            evidence.append(f"{k}:{tx[:40]}")
    log(
        f"检测 用量tip 方式=OCR 分数={score:.2f} "
        f"证据={' | '.join(evidence) if evidence else '-'}"
    )
    return TipHit(
        kind="usage_limit",
        left=mon_l + x0 + lx,
        top=mon_t + y0 + ly,
        right=mon_l + x0 + rx,
        bottom=mon_t + y0 + by,
        score=score,
    )


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
    用量上限：优先 OCR 语义检测；模板仅兜底。
    禁止单独匹配顶栏 Upgrade 按钮。
    """
    # 1) 智能 OCR（主路径）
    if bool(getattr(config, "USAGE_OCR_ENABLED", True)):
        ocr_hit = _detect_usage_limit_ocr(roi, mon_l, mon_t, x0, y0, screen_h)
        if ocr_hit is not None:
            return ocr_hit

    # 2) 旧模板兜底（皮肤未变时仍可用）
    band = config.CHAT_TOAST_Y_BAND
    tpl_toast = _load_template("tip_usage_toast.png")
    hit = _match_scaled(roi, tpl_toast, max(thr, 0.72))
    if hit:
        score, lx, ly, tw, th = hit
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
    hit_u = _match_scaled(roi, tpl_usage, max(thr, 0.78))
    hit_up = _match_scaled(roi, tpl_upgrade, max(thr, 0.82))
    if hit_u and hit_up:
        score_u, lx_u, ly_u, tw_u, th_u = hit_u
        score_up, lx_up, ly_up, tw_up, th_up = hit_up
        if abs(ly_u - ly_up) < 55 and lx_up > lx_u - 40:
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

    if hit_up:
        score_up, lx_up, ly_up, tw_up, th_up = hit_up
        if score_up >= 0.90 and _match_y_in_band(ly_up, th_up, y0, screen_h, band):
            return TipHit(
                kind="usage_limit",
                left=mon_l + x0 + lx_up,
                top=mon_t + y0 + ly_up,
                right=mon_l + x0 + lx_up + tw_up,
                bottom=mon_t + y0 + ly_up + th_up,
                score=score_up,
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
    score = float(max_v)
    lx, ly = int(max_l[0]), int(max_l[1])
    del res
    if score < threshold:
        return None
    return score, lx, ly


def _match_scaled(
    hay: np.ndarray,
    needle: np.ndarray,
    threshold: float,
    scales: Optional[Tuple[float, ...]] = None,
) -> Optional[Tuple[float, int, int, int, int]]:
    """
    多尺度模板匹配。返回 (score, lx, ly, tw, th)，tw/th 为实际匹配用的模板尺寸。
    默认先跑主档尺度；高分早退；接近阈值才补跑其余尺度。
    """
    if needle is None or hay is None:
        return None
    use_scales = scales if scales is not None else getattr(
        config, "MATCH_SCALES", (1.0,)
    )
    margin = float(getattr(config, "MATCH_EARLY_EXIT_MARGIN", 0.04))
    near = float(getattr(config, "MATCH_NEAR_MISS", 0.06))
    primary_n = int(getattr(config, "MATCH_SCALES_PRIMARY", 3))

    # 去重；未显式传 scales 时 1.0 优先；显式传则保留调用方顺序（高分屏可先跑 2.15）
    ordered: list[float] = []
    for s in use_scales:
        if s not in ordered:
            ordered.append(s)
    if scales is None:
        if 1.0 in ordered:
            ordered.remove(1.0)
            ordered.insert(0, 1.0)
        if primary_n > 0 and len(ordered) > primary_n:
            primary = ordered[:primary_n]
            rest = ordered[primary_n:]
        else:
            primary = ordered
            rest = []
    else:
        primary = ordered
        rest = []

    def _run(scale_list: list[float], best_in):
        best = best_in
        best_any = -1.0  # 含低于阈值的最高分，用于 near-miss
        for scale in scale_list:
            owned = False
            if abs(scale - 1.0) < 1e-6:
                scaled = needle
            else:
                nw = max(8, int(round(needle.shape[1] * scale)))
                nh = max(8, int(round(needle.shape[0] * scale)))
                if nh >= hay.shape[0] or nw >= hay.shape[1]:
                    continue
                scaled = cv2.resize(needle, (nw, nh), interpolation=cv2.INTER_AREA)
                owned = True
            if scaled.shape[0] >= hay.shape[0] or scaled.shape[1] >= hay.shape[1]:
                if owned:
                    del scaled
                continue
            res = cv2.matchTemplate(hay, scaled, cv2.TM_CCOEFF_NORMED)
            _min_v, max_v, _min_l, max_l = cv2.minMaxLoc(res)
            score = float(max_v)
            lx, ly = int(max_l[0]), int(max_l[1])
            tw, th = int(scaled.shape[1]), int(scaled.shape[0])
            del res
            if owned:
                del scaled
            if score > best_any:
                best_any = score
            if score < threshold:
                continue
            cand = (score, lx, ly, tw, th)
            if best is None or cand[0] > best[0]:
                best = cand
            # 已足够高则早退（任意尺度），避免高分屏扫完全部尺度超时
            if score >= max(threshold + margin, 0.90):
                return best, best_any, True  # early
        return best, best_any, False

    best, best_any, early = _run(primary, None)
    if early:
        return best
    if best is not None:
        return best
    # 主档接近阈值：补跑其余尺度
    if rest and best_any >= threshold - near:
        best, _ba, _e = _run(rest, best)
        return best
    return best


def detect_tip(threshold: Optional[float] = None) -> Optional[TipHit]:
    """
    在主屏右下 ROI 检测 tip。
    顺序：恢复会话失败 → Connection Error → 用量上限。
    不含更新提示（Update recommended / Update Available；由
    ui_cursor.dismiss_update_recommended_dialog 处理，只关不换号）。
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

    # 2) Too many free trials（Connection Error 特例，须先于普通连接错误）
    too_hit = _detect_too_many_free(roi, mon_l, mon_t, x0, y0, h)
    if too_hit is not None:
        return too_hit

    # 3) Connection Error（位置带 + 整卡/标题正文共现，避免 chat 历史误报）
    conn_thr = min(thr, 0.72)
    conn_hit = _detect_connection_error(roi, mon_l, mon_t, x0, y0, h, conn_thr)
    if conn_hit is not None:
        return conn_hit

    # 4) 用量上限（禁止单独 Upgrade 按钮）
    usage_hit = _detect_usage_limit(roi, mon_l, mon_t, x0, y0, h, thr)
    if usage_hit is not None:
        return usage_hit
    return None


def _detect_too_many_free(
    roi: np.ndarray,
    mon_l: int,
    mon_t: int,
    x0: int,
    y0: int,
    screen_h: int,
) -> Optional[TipHit]:
    """
    「Too many free trial accounts used on this machine…」
    走重置机器码流程，与普通 Connection Error（网络续写）分离。
    """
    thr = float(getattr(config, "TOO_MANY_FREE_THRESHOLD", 0.72))
    band = config.CONN_TOAST_Y_BAND
    tpl = _load_template("tip_too_many_free.png")
    if tpl is None:
        return None
    hit = _match_scaled(roi, tpl, thr)
    if hit is None:
        return None
    score, lx, ly, tw, th = hit
    if not _match_y_in_band(ly, th, y0, screen_h, band):
        return None
    return TipHit(
        kind="too_many_free",
        left=mon_l + x0 + lx,
        top=mon_t + y0 + ly,
        right=mon_l + x0 + lx + tw,
        bottom=mon_t + y0 + ly + th,
        score=score,
    )


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
    hit = _match_scaled(roi, tpl_toast, 0.70)
    if hit:
        score, lx, ly, tw, th = hit
        if _match_y_in_band(ly, th, y0, screen_h, config.CONN_TOAST_Y_BAND):
            if score >= 0.82 or _has_conn_icon_near(roi, lx, ly, th):
                box = (x0 + lx, y0 + ly, x0 + lx + tw, y0 + ly + th)
                return box, "connection_error", "tip_conn_toast.png", score

    tpl_title = _load_template("tip_connection_error.png")
    tpl_body = _load_template("tip_unlimited_tab.png")
    hit_t = _match_scaled(roi, tpl_title, 0.72)
    hit_b = _match_scaled(roi, tpl_body, config.CONN_BODY_ONLY_THRESHOLD)
    if hit_t and hit_b:
        score_t, lx_t, ly_t, tw_t, th_t = hit_t
        score_b, lx_b, ly_b, tw_b, th_b = hit_b
        if ly_t + th_t <= ly_b + 40 and abs(lx_t - lx_b) < 160:
            if _match_y_in_band(ly_t, th_t, y0, screen_h, config.CONN_TOAST_Y_BAND):
                score = max(score_t, score_b)
                if score >= 0.86 or _has_conn_icon_near(
                    roi, min(lx_t, lx_b), min(ly_t, ly_b), th_t + th_b
                ):
                    l = min(x0 + lx_t, x0 + lx_b)
                    t = min(y0 + ly_t, y0 + ly_b)
                    r = max(x0 + lx_t + tw_t, x0 + lx_b + tw_b)
                    b = max(y0 + ly_t + th_t, y0 + ly_b + th_b)
                    return (
                        (l, t, r, b),
                        "connection_error",
                        "tip_connection_error.png",
                        score,
                    )
    elif hit_t:
        score_t, lx_t, ly_t, tw_t, th_t = hit_t
        if score_t >= 0.88 and _match_y_in_band(
            ly_t, th_t, y0, screen_h, config.CONN_TOAST_Y_BAND
        ):
            box = (x0 + lx_t, y0 + ly_t, x0 + lx_t + tw_t, y0 + ly_t + th_t)
            return box, "connection_error", "tip_connection_error.png", score_t

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
            # 轻量复检：同 ROI 再找 tip，避免完整 detect_tip 再跑一遍多尺度风暴
            screen2, _ml2, _mt2 = grab_screen_bgr()
            h2, w2 = screen2.shape[:2]
            roi2 = screen2[y0:y1, x0:x1]
            still_box = _find_post_open_tip_box(roi2, x0, y0, h2)
            del screen2, roi2
            if still_box is None:
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


def _is_forbidden_upgrade_click(
    screen: np.ndarray,
    mon_l: int,
    mon_t: int,
    cx: int,
    cy: int,
    upgrade_boxes: Optional[list] = None,
) -> bool:
    """
    硬禁：禁止点到 Upgrade to Pro 蓝钮。
    - 落在 OCR 识别的 upgrade 框（扩边）内 → 禁
    - 落点邻域呈蓝色按钮色 → 禁
    """
    if upgrade_boxes:
        for lx, ly, rx, by in upgrade_boxes:
            pad = 10
            if (lx - pad) <= cx <= (rx + pad) and (ly - pad) <= cy <= (by + pad):
                return True
    # 屏幕坐标 → 截图像素
    px = int(cx - mon_l)
    py = int(cy - mon_t)
    h, w = screen.shape[:2]
    if px < 2 or py < 2 or px >= w - 2 or py >= h - 2:
        return True
    patch = screen[py - 6 : py + 7, px - 10 : px + 11]
    if patch.size == 0:
        return True
    hsv = cv2.cvtColor(patch, cv2.COLOR_BGR2HSV)
    blue = (
        (hsv[:, :, 0] >= 95)
        & (hsv[:, :, 0] <= 130)
        & (hsv[:, :, 1] >= 70)
        & (hsv[:, :, 2] >= 100)
    )
    if float(np.count_nonzero(blue)) / float(blue.size) > 0.28:
        return True
    return False


def _tip_close_xy_safe(
    title_box: Optional[Tuple[int, int, int, int]],
    upgrade_box: Optional[Tuple[int, int, int, int]],
    hint: Optional[TipHit] = None,
) -> Optional[Tuple[int, int]]:
    """
    只算 tip 卡片右上角 ×：必须在标题行高度、且高于 Upgrade 蓝钮。
    绝不返回 Upgrade 按钮中心。
    """
    if title_box is not None:
        tl, tt, tr, tb = title_box
        if upgrade_box is not None:
            ul, ut, ur, ub = upgrade_box
            # × 在卡片右上：水平贴近 upgrade 右缘外侧或标题右缘更右者
            cx = max(tr, ur) + 18
            cy = tt + max(6, (tb - tt) // 2)
            # 必须明显高于蓝钮顶边
            if cy >= ut - 6:
                cy = ut - 14
            return int(cx), int(cy)
        cx = tr + 160
        cy = tt + max(6, (tb - tt) // 2)
        return int(cx), int(cy)
    if hint is not None and hint.kind == "usage_limit":
        # hint 可能含 upgrade 并集：只取上沿 20% 高度当 × 行，右缘内侧
        hh = max(1, hint.bottom - hint.top)
        cx = hint.right - 18
        cy = hint.top + max(8, int(hh * 0.18))
        # 避开下半（蓝钮常在下半）
        if cy > hint.top + int(hh * 0.40):
            cy = hint.top + max(8, int(hh * 0.18))
        return int(cx), int(cy)
    return None


def close_tip_fast(hint: Optional[TipHit] = None) -> str:
    """
    换号后专用快关 tip。
    硬规则：只点右上 × / Esc；严禁点 Upgrade to Pro（曾误点属严重事故）。
    """
    t0 = time.time()
    try:
        import pyautogui

        pyautogui.FAILSAFE = False
        pyautogui.press("escape")
    except Exception:
        pass
    time.sleep(0.05)

    clicked = False
    way = "仅Esc"
    try:
        screen, mon_l, mon_t = grab_screen_bgr()
        h, w = screen.shape[:2]
        x0, y0, x1, y1 = _roi_rect(h, w)
        roi = screen[y0:y1, x0:x1]

        title_box = None  # abs screen coords
        upgrade_boxes_abs: list = []
        ocr = _get_ocr_engine()
        if ocr is not None:
            y_off = int(roi.shape[0] * float(getattr(config, "USAGE_OCR_Y_CROP", 0.20)))
            sub = roi[y_off:, :]
            max_w = int(getattr(config, "USAGE_OCR_MAX_WIDTH", 960))
            scale = 1.0
            work = sub
            if sub.shape[1] > max_w:
                scale = max_w / float(sub.shape[1])
                work = cv2.resize(
                    sub,
                    (max_w, max(40, int(sub.shape[0] * scale))),
                    interpolation=cv2.INTER_AREA,
                )
            result, _ = ocr(cv2.cvtColor(work, cv2.COLOR_BGR2RGB))
            if result:
                for box, text, _sc in result:
                    kind = _classify_usage_ocr_line(text)
                    if kind is None:
                        continue
                    xs = [float(p[0]) for p in box]
                    ys = [float(p[1]) for p in box]
                    lx = mon_l + x0 + int(min(xs) / scale)
                    ly = mon_t + y0 + int(min(ys) / scale) + y_off
                    rx = mon_l + x0 + int(max(xs) / scale)
                    by = mon_t + y0 + int(max(ys) / scale) + y_off
                    if kind == "title" and title_box is None:
                        title_box = (lx, ly, rx, by)
                    elif kind == "upgrade":
                        upgrade_boxes_abs.append((lx, ly, rx, by))

        upgrade_box = upgrade_boxes_abs[0] if upgrade_boxes_abs else None
        xy = _tip_close_xy_safe(title_box, upgrade_box, hint)
        if xy is not None:
            cx, cy = xy
            if _is_forbidden_upgrade_click(
                screen, mon_l, mon_t, cx, cy, upgrade_boxes_abs
            ):
                log(
                    f"换号 快关tip 拒绝点击 原因=疑似Upgrade按钮 坐标={cx},{cy}"
                )
            else:
                _click_screen(cx, cy)
                clicked = True
                way = "OCR定位×"
                log(f"换号 快关tip 点× 坐标={cx},{cy} 方式={way}")
        elif hint is not None:
            # 无 OCR 时仅用 hint 上沿，仍过蓝钮禁区
            xy2 = _tip_close_xy_safe(None, None, hint)
            if xy2 is not None:
                cx, cy = xy2
                if not _is_forbidden_upgrade_click(
                    screen, mon_l, mon_t, cx, cy, upgrade_boxes_abs
                ):
                    _click_screen(cx, cy)
                    clicked = True
                    way = "hint上沿×"
                    log(f"换号 快关tip 点× 坐标={cx},{cy} 方式={way}")
                else:
                    log(
                        f"换号 快关tip 拒绝点击 原因=hint落点疑似Upgrade "
                        f"坐标={cx},{cy}"
                    )
        del screen
        # 故意不再做窗相对坐标盲点（0.93/0.78 曾打中 Upgrade to Pro）
    except Exception as e:
        log(f"换号 快关tip 异常 {e}")

    ms = (time.time() - t0) * 1000
    log(
        f"换号 快关tip 耗时={ms:.0f}ms 点击={'是' if clicked else '否'} "
        f"方式={way} 禁点Upgrade=是"
    )
    return "快关"


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
                # 只用 tip 框右上沿；禁止 hit.left+820（易落在 Upgrade to Pro）
                safe = _tip_close_xy_safe(None, None, hit)
                if safe is not None:
                    cx, cy = safe
                else:
                    cx = hit.right - ox
                    cy = hit.top + oy

    try:
        # 硬禁 Upgrade to Pro
        if hit.kind == "usage_limit" and _is_forbidden_upgrade_click(
            screen, mon_l, mon_t, int(cx), int(cy), None
        ):
            log(f"关闭提示 拒绝点击 原因=疑似Upgrade按钮 坐标={cx},{cy}")
            # 改点更靠上沿
            cx, cy = hit.right - 18, hit.top + 8
            if _is_forbidden_upgrade_click(screen, mon_l, mon_t, int(cx), int(cy), None):
                log("关闭提示 结果=跳过 原因=无法安全避开Upgrade")
                return "跳过"
        _click_screen(int(cx), int(cy))
        time.sleep(0.35)
        still = detect_tip()
        cn = config.TIP_TYPE_CN.get(hit.kind, hit.kind)
        if still is not None and still.kind == hit.kind:
            # 再试 toast 右上角硬点一次（仍禁蓝钮）
            if toast_box:
                rx, ry = int(toast_box[2] - 18), int(toast_box[1] + 14)
                if not _is_forbidden_upgrade_click(screen, mon_l, mon_t, rx, ry, None):
                    _click_screen(rx, ry)
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
