"""Config must survive the environment GitHub Actions actually produces.

An unset `${{ vars.X }}` is substituted as an EMPTY STRING, not omitted, so
`os.getenv(name, default)` returns "" and `int("")` raises. A run failed on
exactly that. These cases lock the behaviour down.
"""
from __future__ import annotations

import os
import pathlib
import subprocess
import sys

PIPELINE = pathlib.Path(__file__).resolve().parent.parent / "pipeline"

# Everything the workflows pass through `${{ vars.* }}` or `${{ secrets.* }}`.
PASSED_THROUGH = [
    "NEWS_WINDOW_DAYS", "PREDICT_HORIZON_DAYS", "HISTORY_PERIOD",
    "ALERT_PCT_MOVE", "ALERT_VOLUME_Z", "ALERT_RSI_HIGH", "ALERT_RSI_LOW",
    "ALERT_SENTIMENT_ABS", "ALERT_COOLDOWN_HOURS",
    "NTFY_TOPIC", "NTFY_SERVER", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID",
    "CALLMEBOT_PHONE", "CALLMEBOT_APIKEY", "DISCORD_WEBHOOK",
    "GROQ_API_KEY", "GROQ_MODEL", "GEMINI_API_KEY", "GEMINI_MODEL",
    "OPENROUTER_API_KEY", "OPENROUTER_MODEL", "HTTP_TIMEOUT",
]

CHECK = """
import config, llm, alerts, digest, sentiment, run_all
assert isinstance(config.NEWS_WINDOW_DAYS, int) and config.NEWS_WINDOW_DAYS > 0, \
    config.NEWS_WINDOW_DAYS
assert isinstance(config.PREDICT_HORIZON_DAYS, int) and config.PREDICT_HORIZON_DAYS > 0
assert isinstance(config.ALERT_PCT_MOVE, float) and config.ALERT_PCT_MOVE > 0
assert isinstance(config.ALERT_COOLDOWN_HOURS, int)
assert isinstance(config.HTTP_TIMEOUT, int) and config.HTTP_TIMEOUT > 0
assert config.NTFY_SERVER.startswith("http"), config.NTFY_SERVER
assert config.GROQ_MODEL and config.GEMINI_MODEL and config.HISTORY_PERIOD
print("OK", config.NEWS_WINDOW_DAYS, config.PREDICT_HORIZON_DAYS,
      config.ALERT_PCT_MOVE, repr(config.NTFY_SERVER), llm.provider_name())
"""


def run(env_overrides: dict[str, str], label: str) -> None:
    env = {k: v for k, v in os.environ.items() if k not in PASSED_THROUGH}
    env.update(env_overrides)
    proc = subprocess.run(
        [sys.executable, "-c", CHECK], cwd=PIPELINE, env=env,
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        raise AssertionError(f"{label} FAILED\n{proc.stdout}\n{proc.stderr}")
    print(f"  {label}: {proc.stdout.strip().splitlines()[-1]}")


def main() -> int:
    print("config env robustness")

    # The exact failure mode: Actions passes every unset variable as "".
    run({k: "" for k in PASSED_THROUGH}, "all blank (unset Actions vars)")

    # Whitespace-only, which YAML folding can also produce.
    run({k: "   " for k in PASSED_THROUGH}, "all whitespace")

    # Nothing set at all -- plain local run.
    run({}, "all absent")

    # Non-numeric junk must fall back, not crash.
    run({"NEWS_WINDOW_DAYS": "abc", "ALERT_PCT_MOVE": "n/a",
         "ALERT_COOLDOWN_HOURS": "6.5", "HTTP_TIMEOUT": "-"}, "unparseable values")

    # Real values must still be honoured.
    env = {"NEWS_WINDOW_DAYS": "14", "PREDICT_HORIZON_DAYS": "10",
           "ALERT_PCT_MOVE": "1.5", "NTFY_SERVER": "https://ntfy.example.com/"}
    run(env, "real values honoured")

    # And that trailing slash must be stripped, or ntfy URLs get a double slash.
    proc = subprocess.run(
        [sys.executable, "-c", "import config; print(config.NTFY_SERVER)"],
        cwd=PIPELINE, text=True, capture_output=True,
        env={**os.environ, "NTFY_SERVER": "https://ntfy.example.com/"},
    )
    assert proc.stdout.strip() == "https://ntfy.example.com", proc.stdout
    print("  trailing slash stripped: ok")

    print("ALL CONFIG ENV CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
