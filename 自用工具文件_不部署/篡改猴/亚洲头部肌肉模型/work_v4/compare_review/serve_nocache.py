# -*- coding: utf-8 -*-
"""Static server for compare_review with Cache-Control: no-store."""
from __future__ import annotations

import http.server
import socketserver
import sys
import time
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PORT = 8765
URL = f"http://127.0.0.1:{PORT}/"


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        # Keep console quiet; only errors matter for this local tool.
        if args and str(args[1]).startswith(("4", "5")):
            super().log_message(fmt, *args)


class ReuseTCPServer(socketserver.TCPServer):
    allow_reuse_address = True


def main() -> int:
    if not (ROOT / "index.html").exists():
        print(f"[错误] 找不到 index.html：{ROOT / 'index.html'}")
        return 1
    try:
        httpd = ReuseTCPServer(("127.0.0.1", PORT), Handler)
    except OSError as e:
        print(f"[错误] 无法绑定 127.0.0.1:{PORT} — {e}")
        print("可能原因：端口已被占用。请关掉其它「对照页」黑窗口后重试，")
        print(f"或在浏览器直接打开：{URL}")
        return 1

    def out(msg: str) -> None:
        print(msg, flush=True)

    out(f"对照审阅页：{URL}  (no-cache)")
    out(f"目录：{ROOT}")
    out("按 Ctrl+C 可停止服务。")
    # Bind first, then open browser — avoids blank page / connection refused.
    time.sleep(0.2)
    try:
        webbrowser.open(URL)
        out("已请求打开浏览器。若没弹出窗口，请手动打开上面的地址。")
    except Exception as e:
        out(f"[警告] 自动打开浏览器失败：{e}")
        out(f"请手动打开：{URL}")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
