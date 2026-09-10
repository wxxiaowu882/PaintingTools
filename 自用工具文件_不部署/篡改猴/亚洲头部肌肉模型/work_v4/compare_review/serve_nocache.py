# -*- coding: utf-8 -*-
"""Static server for compare_review with Cache-Control: no-store.
API: POST /api/save-json, POST /api/delete-json, project CRUD under projects/.
"""
from __future__ import annotations

import cgi
import hashlib
import http.server
import json
import re
import shutil
import socketserver
import time
import urllib.parse
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PORT = 8765
URL = f"http://127.0.0.1:{PORT}/"
PROJECTS_ROOT = ROOT / "projects"
INDEX_FILE = PROJECTS_ROOT / "index.json"
DEFAULT_GLB = ROOT / "glb" / "euro_ref.glb"


def _json_response(handler: http.server.BaseHTTPRequestHandler, code: int, data) -> None:
    body = json.dumps(data, ensure_ascii=False).encode("utf-8")
    handler.send_response(code)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _read_json(path: Path, default):
    if not path.is_file():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def _write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _safe_rel(rel: str) -> Path:
    if not rel or ".." in rel or rel.startswith("/") or rel.startswith("\\"):
        raise ValueError(f"bad path: {rel!r}")
    target = (ROOT / rel).resolve()
    if not str(target).startswith(str(ROOT.resolve())):
        raise ValueError("path escapes root")
    return target


def _slugify(name: str) -> str:
    stem = Path(name).stem
    s = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", stem)
    s = re.sub(r"\s+", "_", s.strip("._ "))
    ascii_s = re.sub(r"[^A-Za-z0-9_\-]+", "_", s)
    ascii_s = re.sub(r"_+", "_", ascii_s).strip("_")
    if ascii_s:
        return ascii_s[:40]
    digest = hashlib.sha1(stem.encode("utf-8")).hexdigest()[:10]
    return f"m_{digest}"


def _parse_project_id(path: str) -> str:
    raw = path.split("/api/projects/", 1)[1].split("?", 1)[0].strip("/")
    return urllib.parse.unquote(raw, encoding="utf-8", errors="strict")


def read_projects_index() -> dict:
    data = _read_json(INDEX_FILE, {"activeId": "", "items": []})
    if not isinstance(data.get("items"), list):
        data["items"] = []
    if "activeId" not in data:
        data["activeId"] = ""
    return data


def write_projects_index(data: dict) -> None:
    PROJECTS_ROOT.mkdir(parents=True, exist_ok=True)
    _write_json(INDEX_FILE, data)


def unique_project_id(original_name: str) -> str:
    slug = _slugify(original_name)
    ts = time.strftime("%Y%m%d_%H%M%S")
    base = f"p_{ts}_{slug}"
    candidate = base
    n = 1
    while (PROJECTS_ROOT / candidate).is_dir():
        n += 1
        candidate = f"{base}_{n}"
    return candidate


def unique_glb_filename(project_dir: Path, original_name: str) -> str:
    slug = _slugify(original_name)
    ts = time.strftime("%Y%m%d_%H%M%S")
    base = f"{slug}_{ts}.glb"
    candidate = base
    n = 1
    while (project_dir / candidate).exists():
        n += 1
        candidate = f"{slug}_{ts}_{n}.glb"
    return candidate


def project_item_payload(item: dict) -> dict:
    pid = item.get("id", "")
    glb_file = item.get("glbFile", "model.glb")
    return {
        **item,
        "glbUrl": f"projects/{pid}/{glb_file}",
    }


def create_project_from_bytes(original_name: str, data: bytes, *, label: str | None = None) -> dict:
    if not data:
        raise ValueError("empty file")
    pid = unique_project_id(original_name)
    project_dir = PROJECTS_ROOT / pid
    project_dir.mkdir(parents=True, exist_ok=False)
    glb_name = unique_glb_filename(project_dir, original_name)
    glb_path = project_dir / glb_name
    glb_path.write_bytes(data)
    now = time.strftime("%Y-%m-%dT%H:%M:%S")
    meta = {
        "id": pid,
        "label": label or Path(original_name).stem or pid,
        "originalName": original_name,
        "glbFile": glb_name,
        "createdAt": now,
        "updatedAt": now,
    }
    _write_json(project_dir / "meta.json", meta)
    _write_json(project_dir / "history" / "index.json", {"versions": []})
    idx = read_projects_index()
    idx["items"].insert(0, meta)
    idx["activeId"] = pid
    write_projects_index(idx)
    return project_item_payload(meta)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_OPTIONS(self):
        if self.path.startswith("/api/"):
            self.send_response(204)
            self.end_headers()
        else:
            self.send_error(404)

    def do_GET(self):
        if self.path == "/api/health" or self.path.startswith("/api/health?"):
            _json_response(self, 200, {"ok": True, "service": "compare_review"})
            return
        if self.path == "/api/projects" or self.path.startswith("/api/projects?"):
            idx = read_projects_index()
            items = [project_item_payload(x) for x in idx.get("items", [])]
            _json_response(self, 200, {"activeId": idx.get("activeId", ""), "items": items})
            return
        super().do_GET()

    def do_DELETE(self):
        if self.path.startswith("/api/projects/"):
            try:
                pid = _parse_project_id(self.path)
            except Exception:
                _json_response(self, 400, {"ok": False, "error": "bad id"})
                return
            if not pid or "/" in pid or ".." in pid:
                _json_response(self, 400, {"ok": False, "error": "bad id"})
                return
            project_dir = PROJECTS_ROOT / pid
            if not project_dir.is_dir():
                _json_response(self, 404, {"ok": False, "error": "not found"})
                return
            try:
                shutil.rmtree(project_dir)
            except OSError as e:
                _json_response(
                    self,
                    500,
                    {"ok": False, "error": f"delete failed: {e}"},
                )
                return
            idx = read_projects_index()
            idx["items"] = [x for x in idx.get("items", []) if x.get("id") != pid]
            if idx.get("activeId") == pid:
                idx["activeId"] = idx["items"][0]["id"] if idx["items"] else ""
            write_projects_index(idx)
            _json_response(self, 200, {"ok": True, "activeId": idx.get("activeId", "")})
            return
        self.send_error(404)

    def do_POST(self):
        if self.path == "/api/projects/import":
            self._handle_project_import()
            return
        if self.path == "/api/projects/from-default":
            self._handle_project_from_default()
            return
        if self.path == "/api/projects/active":
            self._handle_project_set_active()
            return
        if self.path == "/api/save-json":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            try:
                payload = json.loads(body)
                rel = payload.get("path", "")
                data = payload.get("data")
                target = _safe_rel(rel)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
                _json_response(self, 200, {"ok": True})
            except Exception as e:
                _json_response(self, 400, {"ok": False, "error": str(e)})
            return
        if self.path == "/api/delete-json":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            try:
                payload = json.loads(body)
                rel = payload.get("path", "")
                target = _safe_rel(rel)
                if target.is_file():
                    target.unlink()
                _json_response(self, 200, {"ok": True})
            except Exception as e:
                _json_response(self, 400, {"ok": False, "error": str(e)})
            return
        self.send_error(404)

    def _handle_project_import(self):
        try:
            ctype = self.headers.get("Content-Type", "")
            if "multipart/form-data" not in ctype:
                raise ValueError("expect multipart/form-data")
            length = int(self.headers.get("Content-Length", 0))
            form = cgi.FieldStorage(
                fp=self.rfile,
                headers=self.headers,
                environ={
                    "REQUEST_METHOD": "POST",
                    "CONTENT_TYPE": ctype,
                    "CONTENT_LENGTH": str(length),
                },
            )
            if "file" not in form:
                raise ValueError("missing file field")
            fileitem = form["file"]
            if not fileitem.filename:
                raise ValueError("empty filename")
            original = Path(fileitem.filename).name
            if not original.lower().endswith((".glb", ".gltf")):
                raise ValueError("only .glb / .gltf supported")
            data = fileitem.file.read()
            label = form.getvalue("label") if "label" in form else None
            meta = create_project_from_bytes(original, data, label=label)
            _json_response(self, 200, {"ok": True, "project": meta})
        except Exception as e:
            _json_response(self, 400, {"ok": False, "error": str(e)})

    def _handle_project_from_default(self):
        try:
            if not DEFAULT_GLB.is_file():
                raise FileNotFoundError(f"missing default glb: {DEFAULT_GLB.name}")
            data = DEFAULT_GLB.read_bytes()
            meta = create_project_from_bytes("euro_ref.glb", data, label="欧版参考")
            _json_response(self, 200, {"ok": True, "project": meta})
        except Exception as e:
            _json_response(self, 400, {"ok": False, "error": str(e)})

    def _handle_project_set_active(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            payload = json.loads(body) if body else {}
            pid = payload.get("id", "")
            idx = read_projects_index()
            if pid and not any(x.get("id") == pid for x in idx.get("items", [])):
                raise ValueError("project not found")
            idx["activeId"] = pid or ""
            write_projects_index(idx)
            _json_response(self, 200, {"ok": True, "activeId": idx["activeId"]})
        except Exception as e:
            _json_response(self, 400, {"ok": False, "error": str(e)})

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
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
