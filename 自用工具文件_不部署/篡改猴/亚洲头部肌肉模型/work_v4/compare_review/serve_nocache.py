# -*- coding: utf-8 -*-
"""Static server for compare_review with Cache-Control: no-store.
Bonus: POST /api/save-json { path: str, data: any } to save landmark JSON files.
"""
from __future__ import annotations

import http.server
import json
import socketserver
import time
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PORT = 8765
URL = f"http://127.0.0.1:{PORT}/"


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_POST(self):
        if self.path == "/api/save-json":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            try:
                payload = json.loads(body)
                rel = payload.get("path", "")
                data = payload.get("data")
                if not rel or ".." in rel or rel.startswith("/"):
                    raise ValueError(f"bad path: {rel!r}")
                target = (ROOT / rel).resolve()
                if not str(target).startswith(str(ROOT)):
                    raise ValueError("path escapes root")
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
                resp = json.dumps({"ok": True}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(resp)))
                self.end_headers()
                self.wfile.write(resp)
            except Exception as e:
                msg = str(e).encode()
                self.send_response(400)
                self.send_header("Content-Type", "text/plain")
                self.send_header("Content-Length", str(len(msg)))
                self.end_headers()
                self.wfile.write(msg)
        else:
            self.send_error(404)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def log_message(self, fmt, *args):
        # Keep console quiet; only errors matter for this local tool.
        if args and str(args[1]).startswith(("4", "5")):
            super().log_message(fmt, *args)


class ReuseTCPServer(socketserver.TCPServer):
    allow_reuse_address = True


def main() -> int:
    import sys

    no_browser = "--no-browser" in sys.argv
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
    if not no_browser:
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
