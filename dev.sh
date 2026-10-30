#!/usr/bin/env bash
# Local development: serves the repo root (web/ reaches ../data) plus the
# local API, so adding a ticker or "Update now" runs the pipeline here.
set -euo pipefail
cd "$(dirname "$0")"
PY=python3
[[ -x .venv/bin/python ]] && PY=.venv/bin/python
exec "$PY" pipeline/local_server.py
