# -*- coding: utf-8 -*-
"""
自动换号后台监控：状态机主循环。
状态：监控中 → 换号中 → 打开后清提示 → 宽限 → 监控中
"""
from __future__ import annotations

import os
import sys
import time
from datetime import datetime

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

import config
import detect_tip
import ui_assist
import ui_cursor
from logutil import log


class Monitor:
    def __init__(self) -> None:
        self.state = "监控中"  # 监控中 | 换号中
        self.grace_until: float = 0.0
        self._switching = False
        self._fail_cooldown_until: float = 0.0
        self._tip_streak_kind: str | None = None
        self._tip_streak_count: int = 0

    def in_grace(self) -> bool:
        return time.time() < self.grace_until

    def _reset_tip_streak(self) -> None:
        self._tip_streak_kind = None
        self._tip_streak_count = 0

    def start_grace(self) -> None:
        self.grace_until = time.time() + config.GRACE_SECONDS
        self._reset_tip_streak()
        end = datetime.fromtimestamp(self.grace_until).strftime("%H:%M:%S")
        log(f"宽限 开始 结束于={end} 时长={config.GRACE_SECONDS}秒")

    def do_switch(self, tip_kind: str) -> None:
        """完整换号流程（互斥）。重启未发生则中止，不进入宽限。"""
        if self._switching:
            return
        self._switching = True
        self.state = "换号中"
        cn = config.TIP_TYPE_CN.get(tip_kind, tip_kind)
        try:
            log(f"状态 换号中 触发={cn}")
            try:
                detect_tip.close_tip()
            except Exception:
                pass

            ui_cursor.save_all()
            if not ui_assist.refresh_and_confirm():
                log("错误 换号流程中断 助手刷新失败")
                self._fail_cooldown_until = time.time() + config.SWITCH_FAIL_COOLDOWN
                return

            restarted = ui_cursor.wait_cursor_restart()
            if not restarted:
                # 常见原因：确认换号没点到 → Cursor 根本没关
                log("换号 未观察到Cursor关闭 尝试再次刷新并确认")
                if ui_assist.refresh_confirm_retry_once():
                    restarted = ui_cursor.wait_cursor_restart()

            if not restarted:
                log("错误 换号未成功 Cursor未真正重启 不进入宽限")
                self._fail_cooldown_until = time.time() + config.SWITCH_FAIL_COOLDOWN
                return

            ui_cursor.click_editor_window_if_any()
            result = ui_cursor.open_paintingtools()
            if result == "失败":
                log("错误 打开工程失败")
                self._fail_cooldown_until = time.time() + config.SWITCH_FAIL_COOLDOWN
                return

            # 命令行打开后仍可能停在 Agent 主页，再点一次 Editor Window
            time.sleep(2.0)
            ui_cursor.click_editor_window_if_any(timeout=10)
            # 工程窗必须置前最大化，否则关 tip 会点到被挡住的区域
            time.sleep(0.6)
            ui_cursor.bring_paintingtools_front_max()
            # Connection Error tip 常晚于最大化才出现，多等一会再扫
            time.sleep(2.0)
            cleared = detect_tip.close_post_open_tips(max_rounds=5)
            log(f"打开后清提示 结果={cleared}")
            time.sleep(0.6)
            ui_cursor.send_continue_in_chat()
            self.start_grace()
        except Exception as e:
            log(f"错误 换号异常 {e}")
            self._fail_cooldown_until = time.time() + config.SWITCH_FAIL_COOLDOWN
        finally:
            self._switching = False
            self.state = "监控中"
            log("状态 监控中")

    def on_tip(self, hit: detect_tip.TipHit) -> None:
        cn = config.TIP_TYPE_CN.get(hit.kind, hit.kind)
        if self._switching or self.state == "换号中":
            log(f"提示 {cn} 动作=忽略 原因=换号中")
            return
        if self.in_grace():
            # 宽限内不处理 tip：续写后 chat 历史易误匹配，强行关 tip 还会提前结束宽限
            log(f"提示 {cn} 动作=忽略 宽限中=是 分数={hit.score:.2f}")
            self._reset_tip_streak()
            return
        if time.time() < self._fail_cooldown_until:
            log(f"提示 {cn} 动作=暂缓 原因=换号失败冷却中")
            self._reset_tip_streak()
            return

        if hit.kind == self._tip_streak_kind:
            self._tip_streak_count += 1
        else:
            self._tip_streak_kind = hit.kind
            self._tip_streak_count = 1

        need = config.TIP_CONFIRM_POLLS
        if self._tip_streak_count < need:
            log(
                f"提示 {cn} 动作=待确认 连续={self._tip_streak_count}/{need} "
                f"分数={hit.score:.2f} 位置={hit.left},{hit.top}"
            )
            return

        self._reset_tip_streak()
        log(f"提示 {cn} 动作=换号 宽限中=否 连续确认={need} 分数={hit.score:.2f}")
        self.do_switch(hit.kind)

    def loop(self) -> None:
        log("状态 监控中")
        log(
            f"配置 工程={config.PROJECT_PATH} 轮询={config.POLL_INTERVAL}秒 "
            f"宽限={config.GRACE_SECONDS}秒 连续确认={config.TIP_CONFIRM_POLLS}次"
        )
        while True:
            try:
                if self._switching:
                    time.sleep(config.POLL_INTERVAL)
                    continue
                hit = detect_tip.detect_tip()
                if hit is not None:
                    self.on_tip(hit)
                else:
                    self._reset_tip_streak()
                time.sleep(config.POLL_INTERVAL)
            except KeyboardInterrupt:
                log("状态 已停止 用户中断")
                break
            except Exception as e:
                log(f"错误 主循环 {e}")
                time.sleep(config.POLL_INTERVAL)


def _acquire_single_instance() -> None:
    """同一机器只允许一个 monitor.py 进程，避免重复换号。"""
    config.LOGS_DIR.mkdir(parents=True, exist_ok=True)
    lock_path = config.LOGS_DIR / "monitor.lock"
    import msvcrt

    try:
        lock_f = open(lock_path, "w", encoding="utf-8")
        lock_f.write(str(os.getpid()))
        lock_f.flush()
        msvcrt.locking(lock_f.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
        old_pid = ""
        try:
            old_pid = lock_path.read_text(encoding="utf-8").strip()
        except Exception:
            pass
        if old_pid:
            log(f"错误 已有监控进程在运行 pid={old_pid} 请勿重复启动")
        else:
            log("错误 已有监控进程在运行，请勿重复启动")
        sys.exit(1)
    # 进程退出时释放锁
    import atexit

    def _release() -> None:
        try:
            lock_f.seek(0)
            msvcrt.locking(lock_f.fileno(), msvcrt.LK_UNLCK, 1)
            lock_f.close()
        except Exception:
            pass

    atexit.register(_release)


def main() -> None:
    import win_util

    win_util.set_dpi_aware()
    _acquire_single_instance()
    missing = []
    for mod in ("cv2", "mss", "numpy", "PIL", "pywinauto", "pyautogui"):
        try:
            __import__(mod if mod != "PIL" else "PIL")
        except ImportError:
            missing.append(mod)
    if missing:
        log(f"错误 缺少依赖 {','.join(missing)} 请先 pip install -r requirements.txt")
        sys.exit(1)
    if not config.TEMPLATES_DIR.is_dir():
        log("错误 缺少 templates 目录")
        sys.exit(1)
    Monitor().loop()


if __name__ == "__main__":
    main()
