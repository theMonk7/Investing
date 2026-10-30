"""Local dashboard server: the static site plus a small API so the page can
save the watchlist and run the pipeline on this machine, with no GitHub.

    python pipeline/local_server.py        # or ./dev.sh

Binds to 127.0.0.1 only. Mutating calls must carry the X-Mktdesk header,
which another site cannot send without a CORS preflight this server never
grants, and the Host header must be local (blocks DNS rebinding).
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import threading
import time
import uuid
from collections import deque
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parent.parent
PIPELINE = ROOT / "pipeline"
WATCHLIST = ROOT / "watchlist.json"
MODES = {"quick", "news", "events", "quotes", "full"}
MARKETS = ("IN", "US")
SYMBOL_RE = re.compile(r"^[A-Z0-9^][A-Z0-9.&=-]{0,19}$")
LOCAL_HOSTS = {"127.0.0.1", "localhost", "[::1]"}
MAX_BODY = 64 * 1024
MAX_RUNS = 50

runs: dict[str, dict] = {}
run_lock = threading.Lock()        # runs share market.db, so one at a time
watchlist_lock = threading.Lock()


def clean_symbols(values) -> list[str]:
    if not isinstance(values, list):
        raise ValueError("symbols must be a list")
    out = []
    for value in values:
        sym = str(value).strip().upper()
        if not SYMBOL_RE.match(sym):
            raise ValueError(f"not a ticker: {str(value)[:24]!r}")
        if sym not in out:
            out.append(sym)
    return out


def read_watchlist() -> dict:
    try:
        return json.loads(WATCHLIST.read_text())
    except (OSError, ValueError):
        return {"version": 1, "IN": [], "US": []}


def save_watchlist(body: dict) -> dict:
    with watchlist_lock:
        current = read_watchlist()
        for market in MARKETS:
            if market in body:
                current[market] = clean_symbols(body[market])
        tmp = WATCHLIST.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(current, indent=2) + "\n")
        tmp.replace(WATCHLIST)
    return current


def public(run: dict) -> dict:
    log = list(run["log"])
    return {"id": run["id"], "mode": run["mode"], "status": run["status"],
            "conclusion": run["conclusion"], "started_at": run["started_at"],
            "error": run.get("error"), "log": log[-15:]}


def start_run(mode, markets, symbols) -> dict:
    if mode not in MODES:
        raise ValueError(f"unknown mode {str(mode)[:20]!r}")
    if not isinstance(markets, list):
        raise ValueError("markets must be a list")
    markets = [m for m in markets if m in MARKETS] or list(MARKETS)
    symbols = clean_symbols(symbols)
    run = {"id": uuid.uuid4().hex[:12], "mode": mode, "status": "queued",
           "conclusion": None, "started_at": time.time(), "log": deque(maxlen=60)}
    runs[run["id"]] = run
    for old in list(runs)[:-MAX_RUNS]:
        runs.pop(old, None)
    threading.Thread(target=execute, args=(run, markets, symbols), daemon=True).start()
    return run


def execute(run: dict, markets: list[str], symbols: list[str]) -> None:
    with run_lock:
        run["status"] = "in_progress"
        cmd = [sys.executable, "run_all.py", "--mode", run["mode"], "--markets", ",".join(markets)]
        if symbols:
            cmd.append("--symbols=" + ",".join(symbols))
        print(f"[run {run['id']}] {' '.join(cmd[1:])}", flush=True)
        try:
            proc = subprocess.Popen(cmd, cwd=PIPELINE, stdout=subprocess.PIPE,
                                    stderr=subprocess.STDOUT, text=True, bufsize=1)
            for line in proc.stdout:
                line = line.rstrip()
                run["log"].append(line)
                print(f"[run {run['id']}] {line}", flush=True)
            code = proc.wait()
        except OSError as exc:
            run["log"].append(str(exc))
            code = -1
        run["conclusion"] = "success" if code == 0 else "failure"
        if code != 0:
            lines = [l for l in run["log"] if l.strip()]
            run["error"] = f"Local run failed: {lines[-1][:200] if lines else f'exit {code}'}"
        run["status"] = "completed"


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        if not self.path.startswith("/api/runs/"):       # polling would flood the log
            super().log_message(fmt, *args)

    def send_json(self, code: int, payload) -> None:
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_body(self) -> dict:
        size = int(self.headers.get("Content-Length") or 0)
        if size > MAX_BODY:
            raise ValueError("request too large")
        body = json.loads(self.rfile.read(size) or b"{}")
        if not isinstance(body, dict):
            raise ValueError("expected a JSON object")
        return body

    def api(self, method: str) -> None:
        host = (self.headers.get("Host") or "").rsplit(":", 1)[0]
        if host not in LOCAL_HOSTS:
            return self.send_json(403, {"error": "forbidden host"})
        if method != "GET" and self.headers.get("X-Mktdesk") != "1":
            return self.send_json(403, {"error": "missing X-Mktdesk header"})
        path = self.path.split("?", 1)[0]
        try:
            if method == "GET" and path == "/api/health":
                return self.send_json(200, {"ok": True, "root": ROOT.name})
            if method == "GET" and path == "/api/watchlist":
                return self.send_json(200, read_watchlist())
            if method == "PUT" and path == "/api/watchlist":
                return self.send_json(200, save_watchlist(self.read_body()))
            if method == "POST" and path == "/api/runs":
                body = self.read_body()
                run = start_run(body.get("mode"), body.get("markets", []), body.get("symbols", []))
                return self.send_json(202, public(run))
            match = re.fullmatch(r"/api/runs/([0-9a-f]{12})", path)
            if method == "GET" and match:
                run = runs.get(match.group(1))
                return self.send_json(200, public(run)) if run else self.send_json(
                    404, {"error": "unknown run (was the server restarted?)"})
        except (ValueError, TypeError) as exc:
            return self.send_json(400, {"error": str(exc)})
        return self.send_json(404, {"error": "not found"})

    def hidden(self) -> bool:
        # Dotfiles (.git, .env, .venv) are never served.
        path = unquote(self.path.split("?", 1)[0])
        return any(part.startswith(".") for part in path.replace("\\", "/").split("/"))

    def do_GET(self):
        if self.path.startswith("/api/"):
            return self.api("GET")
        if self.hidden():
            return self.send_error(404)
        return super().do_GET()

    def do_HEAD(self):
        if self.hidden():
            return self.send_error(404)
        return super().do_HEAD()

    def do_POST(self):
        return self.api("POST") if self.path.startswith("/api/") else self.send_error(405)

    def do_PUT(self):
        return self.api("PUT") if self.path.startswith("/api/") else self.send_error(405)


def main() -> None:
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, directory=str(ROOT)))
    print(f"Dashboard: http://127.0.0.1:{port}/web/index.html")
    print("Local mode: watchlist edits save to watchlist.json; updates run the pipeline here.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
