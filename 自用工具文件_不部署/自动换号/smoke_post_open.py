# -*- coding: utf-8 -*-
"""
冒烟：当前已在 PaintingTools 最大化页时，只测「关 tip + 续写」。
用法（管理员）：python smoke_post_open.py
"""
from __future__ import annotations

import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

import detect_tip
import ui_cursor
from logutil import log


def main() -> None:
    log("冒烟 开始 关提示+续写")
    ui_cursor.bring_paintingtools_front_max()
    cleared = detect_tip.close_post_open_tips(max_rounds=5)
    log(f"打开后清提示 结果={cleared}")
    ok = ui_cursor.send_continue_in_chat()
    log(f"冒烟 结束 续写={'成功' if ok else '失败'}")


if __name__ == "__main__":
    main()
