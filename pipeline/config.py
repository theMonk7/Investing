"""Central configuration. Everything overridable via env vars so GitHub Actions
secrets are the only place real credentials ever live."""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "market.db"
WATCHLIST_PATH = ROOT / "watchlist.json"

DATA_DIR.mkdir(exist_ok=True)

# --- analysis windows -------------------------------------------------------
# "last D days" news window used for sentiment aggregation and prediction.
NEWS_WINDOW_DAYS = int(os.getenv("NEWS_WINDOW_DAYS", "7"))
# How far ahead the classifier predicts.
PREDICT_HORIZON_DAYS = int(os.getenv("PREDICT_HORIZON_DAYS", "5"))
# Years of daily history pulled for indicators + model training.
HISTORY_PERIOD = os.getenv("HISTORY_PERIOD", "3y")

# --- alert thresholds -------------------------------------------------------
ALERT_PCT_MOVE = float(os.getenv("ALERT_PCT_MOVE", "3.0"))        # abs % day move
ALERT_VOLUME_Z = float(os.getenv("ALERT_VOLUME_Z", "2.5"))        # volume z-score
ALERT_RSI_HIGH = float(os.getenv("ALERT_RSI_HIGH", "72"))
ALERT_RSI_LOW = float(os.getenv("ALERT_RSI_LOW", "28"))
ALERT_SENTIMENT_ABS = float(os.getenv("ALERT_SENTIMENT_ABS", "0.45"))
ALERT_COOLDOWN_HOURS = int(os.getenv("ALERT_COOLDOWN_HOURS", "6"))

# --- notification channels (all optional; missing = channel skipped) --------
NTFY_TOPIC = os.getenv("NTFY_TOPIC", "")          # e.g. "myname-stocks-9f3k"
NTFY_SERVER = os.getenv("NTFY_SERVER", "https://ntfy.sh")
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")
CALLMEBOT_PHONE = os.getenv("CALLMEBOT_PHONE", "")   # WhatsApp, +91XXXXXXXXXX
CALLMEBOT_APIKEY = os.getenv("CALLMEBOT_APIKEY", "")
DISCORD_WEBHOOK = os.getenv("DISCORD_WEBHOOK", "")

# --- optional LLM -----------------------------------------------------------
# Provider is auto-detected from whichever key exists. Everything degrades to
# deterministic template output when no key is set.
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "meta-llama/llama-3.3-70b-instruct:free")

HTTP_TIMEOUT = int(os.getenv("HTTP_TIMEOUT", "25"))
USER_AGENT = "Mozilla/5.0 (compatible; investing-dashboard/1.0)"
