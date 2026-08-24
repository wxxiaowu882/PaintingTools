# -*- coding: utf-8 -*-
"""中文日志：控制台 + 按日文件。"""
from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path

import config


def _ensure_log_dir() -> Path:
    config.LOGS_DIR.mkdir(parents=True, exist_ok=True)
    return config.LOGS_DIR


def _log_path() -> Path:
    day = datetime.now().strftime("%Y%m%d")
    return _ensure_log_dir() / f"监控_{day}.log"


def log(msg: str) -> None:
    """写入一行中文日志，格式：[HH:MM:SS] 内容"""
    ts = datetime.now().strftime("%H:%M:%S")
    line = f"[{ts}] {msg}"
    try:
        print(line, flush=True)
    except Exception:
        try:
            sys.stdout.buffer.write((line + "\n").encode("utf-8", errors="replace"))
            sys.stdout.buffer.flush()
        except Exception:
            pass
    try:
        with open(_log_path(), "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception as e:
        try:
            print(f"[{ts}] 错误 写日志失败 {e}", flush=True)
        except Exception:
            pass
