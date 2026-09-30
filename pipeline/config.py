"""Central configuration. Everything overridable via env vars so GitHub Actions
secrets are the only place real credentials ever live.

A note on blanks: GitHub Actions substitutes an **empty string** for an unset
`${{ vars.X }}`, so the variable is present but blank. `os.getenv(name,
default)` never returns the default in that case, and `int("")` raises. Every
read below goes through the helpers, which treat blank -- and unparseable --
values as "not set".
"""
from __future__ import annotations

import os
from pathlib import Path


def _raw(name: str) -> str | None:
    value = os.getenv(name)
    if value is None:
        return None
    value = value.strip()
    return value or None


def env_str(name: str, default: str = "") -> str:
    return _raw(name) or default


def env_int(name: str, default: int) -> int:
    value = _raw(name)
    if value is None:
        return default
    try:
        return int(float(value))
    except ValueError:
        print(f"[config] {name}={value!r} is not a number; using {default}")
        return default


def env_float(name: str, default: float) -> float:
    value = _raw(name)
    if value is None:
        return default
    try:
        return float(value)
    except ValueError:
        print(f"[config] {name}={value!r} is not a number; using {default}")
        return default


ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "market.db"
WATCHLIST_PATH = ROOT / "watchlist.json"

DATA_DIR.mkdir(exist_ok=True)

# --- analysis windows -------------------------------------------------------
# "last D days" news window used for sentiment aggregation and prediction.
NEWS_WINDOW_DAYS = env_int("NEWS_WINDOW_DAYS", 7)
# How far ahead the classifier predicts.
PREDICT_HORIZON_DAYS = env_int("PREDICT_HORIZON_DAYS", 5)
# Years of daily history pulled for indicators + model training.
HISTORY_PERIOD = env_str("HISTORY_PERIOD", "3y")

# --- alert thresholds -------------------------------------------------------
ALERT_PCT_MOVE = env_float("ALERT_PCT_MOVE", 3.0)        # abs % day move
ALERT_VOLUME_Z = env_float("ALERT_VOLUME_Z", 2.5)        # volume z-score
ALERT_RSI_HIGH = env_float("ALERT_RSI_HIGH", 72.0)
ALERT_RSI_LOW = env_float("ALERT_RSI_LOW", 28.0)
ALERT_SENTIMENT_ABS = env_float("ALERT_SENTIMENT_ABS", 0.45)
ALERT_COOLDOWN_HOURS = env_int("ALERT_COOLDOWN_HOURS", 6)

# --- notification channels (all optional; missing = channel skipped) --------
NTFY_TOPIC = env_str("NTFY_TOPIC")                # e.g. "myname-stocks-9f3k"
NTFY_SERVER = env_str("NTFY_SERVER", "https://ntfy.sh").rstrip("/")
TELEGRAM_BOT_TOKEN = env_str("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT_ID = env_str("TELEGRAM_CHAT_ID")
CALLMEBOT_PHONE = env_str("CALLMEBOT_PHONE")      # WhatsApp, +91XXXXXXXXXX
CALLMEBOT_APIKEY = env_str("CALLMEBOT_APIKEY")
DISCORD_WEBHOOK = env_str("DISCORD_WEBHOOK")

# --- optional LLM -----------------------------------------------------------
# Provider is auto-detected from whichever key exists. Everything degrades to
# deterministic template output when no key is set.
GROQ_API_KEY = env_str("GROQ_API_KEY")
GROQ_MODEL = env_str("GROQ_MODEL", "llama-3.3-70b-versatile")
GEMINI_API_KEY = env_str("GEMINI_API_KEY")
GEMINI_MODEL = env_str("GEMINI_MODEL", "gemini-2.0-flash")
OPENROUTER_API_KEY = env_str("OPENROUTER_API_KEY")
OPENROUTER_MODEL = env_str("OPENROUTER_MODEL", "meta-llama/llama-3.3-70b-instruct:free")

# --- SEC EDGAR --------------------------------------------------------------
# The SEC requires a User-Agent containing a real contact email and returns
# 403 without one. Deliberately not defaulted to anything: set it yourself and
# the US filings feed switches on; leave it blank and that feed is skipped.
SEC_CONTACT_EMAIL = env_str("SEC_CONTACT_EMAIL")

HTTP_TIMEOUT = env_int("HTTP_TIMEOUT", 25)
USER_AGENT = "Mozilla/5.0 (compatible; investing-dashboard/1.0)"
