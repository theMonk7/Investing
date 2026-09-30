#!/usr/bin/env bash
# Local development helper. Serves the repo root so web/ can reach ../data.
set -euo pipefail
PORT="${PORT:-8000}"
cd "$(dirname "$0")"
echo "Dashboard: http://127.0.0.1:${PORT}/web/index.html"
exec python3 -m http.server "$PORT"
