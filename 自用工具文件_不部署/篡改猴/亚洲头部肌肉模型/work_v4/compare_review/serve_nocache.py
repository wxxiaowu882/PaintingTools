# -*- coding: utf-8 -*-
"""Static server for compare_review with Cache-Control: no-store."""
from __future__ import annotations

import http.server
import socketserver
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PORT = 8765


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        super().end_headers()


if __name__ == "__main__":
    with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
        print(f"对照审阅页：http://127.0.0.1:{PORT}/  (no-cache)")
        print(f"目录：{ROOT}")
        httpd.serve_forever()
