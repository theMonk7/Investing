"""Scheduled digest pushed to the phone.

Separate from alerts on purpose: alerts are event-driven and noisy by nature,
the digest is one scheduled message you actually read.
"""
from __future__ import annotations

import argparse
import json
import sys

import requests

import config
from config import DATA_DIR


def load(market: str) -> dict | None:
    path = DATA_DIR / market / "bundle.json"
    if not path.exists():
        return None
    return json.loads(path.read_text())


def compose(markets: list[str]) -> tuple[str, str]:
    title_bits, body_lines = [], []

    for market in markets:
        b = load(market)
        if not b:
            body_lines.append(f"{market}: no data")
            continue
        r = b.get("regime", {})
        s = b.get("market_sentiment", {})
        flag = "IN" if market == "IN" else "US"
        title_bits.append(f"{flag} {r.get('index_change_pct', 0):+.2f}%")

        body_lines.append(f"── {flag} ──")
        body_lines.append(f"{r.get('regime', 'unknown')}")
        body_lines.append(
            f"Index {r.get('index_close', '?')} ({r.get('index_change_pct', 0):+.2f}%), "
            f"breadth {r.get('advancers_pct', 0):.0f}% advancing, "
            f"{r.get('pct_above_sma50', 0):.0f}% above 50-DMA")
        if r.get("vix") is not None:
            body_lines.append(f"Volatility {r['vix']} ({r.get('vix_change_pct', 0):+.1f}%)")
        body_lines.append(f"News tone: {s.get('label', 'neutral')} "
                          f"({s.get('score', 0):+.2f}) over {s.get('count', 0)} stories")

        sectors = b.get("sectors", [])
        if sectors:
            body_lines.append(f"Leading: {sectors[0]['sector']} ({sectors[0]['ret_5d']:+.1f}% 5d) · "
                              f"Lagging: {sectors[-1]['sector']} ({sectors[-1]['ret_5d']:+.1f}%)")

        watched = [q for q in b.get("quotes", []) if q.get("watched")]
        watched.sort(key=lambda q: -abs(q["change_pct"]))
        if watched:
            body_lines.append("Your watchlist movers:")
            for q in watched[:6]:
                body_lines.append(f"  {q['symbol'].replace('.NS', '')} {q['change_pct']:+.2f}% "
                                  f"(RSI {q['rsi14']:.0f}, vol {q['vol_z']:+.1f}σ)")

        ideas = (b.get("candidates") or {}).get("bullish", [])[:3]
        if ideas:
            body_lines.append("Screener top setups: " + ", ".join(
                f"{i['symbol'].replace('.NS', '')} ({i['combined_score']:+.1f})" for i in ideas))
        body_lines.append("")

    body_lines.append("Educational only. Not investment advice.")
    return " · ".join(title_bits) or "Market digest", "\n".join(body_lines)


def send(title: str, body: str) -> list[str]:
    sent = []
    if config.NTFY_TOPIC:
        try:
            resp = requests.post(
                f"{config.NTFY_SERVER}/{config.NTFY_TOPIC}",
                data=body.encode("utf-8"),
                headers={"Title": f"Market digest — {title}", "Tags": "newspaper",
                         "Priority": "default"},
                timeout=config.HTTP_TIMEOUT)
            if resp.ok:
                sent.append("ntfy")
        except Exception as exc:  # noqa: BLE001
            print(f"[digest] ntfy failed: {exc}")

    if config.TELEGRAM_BOT_TOKEN and config.TELEGRAM_CHAT_ID:
        try:
            resp = requests.post(
                f"https://api.telegram.org/bot{config.TELEGRAM_BOT_TOKEN}/sendMessage",
                json={"chat_id": config.TELEGRAM_CHAT_ID,
                      "text": f"📊 Market digest — {title}\n\n{body}"[:4000]},
                timeout=config.HTTP_TIMEOUT)
            if resp.ok:
                sent.append("telegram")
        except Exception as exc:  # noqa: BLE001
            print(f"[digest] telegram failed: {exc}")

    if config.CALLMEBOT_PHONE and config.CALLMEBOT_APIKEY:
        try:
            resp = requests.get(
                "https://api.callmebot.com/whatsapp.php",
                params={"phone": config.CALLMEBOT_PHONE,
                        "text": f"Market digest - {title}\n\n{body}"[:900],
                        "apikey": config.CALLMEBOT_APIKEY},
                timeout=config.HTTP_TIMEOUT)
            if resp.ok:
                sent.append("whatsapp")
        except Exception as exc:  # noqa: BLE001
            print(f"[digest] whatsapp failed: {exc}")

    if config.DISCORD_WEBHOOK:
        try:
            resp = requests.post(config.DISCORD_WEBHOOK,
                                 json={"content": f"**Market digest — {title}**\n```\n{body[:1800]}\n```"},
                                 timeout=config.HTTP_TIMEOUT)
            if resp.ok:
                sent.append("discord")
        except Exception as exc:  # noqa: BLE001
            print(f"[digest] discord failed: {exc}")
    return sent


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--markets", default="IN,US")
    ap.add_argument("--dry-run", action="store_true",
                    help="print the message instead of sending it")
    args = ap.parse_args()

    title, body = compose([m for m in args.markets.split(",") if m in ("IN", "US")])
    if args.dry_run:
        print(f"TITLE: {title}\n\n{body}")
        return 0

    channels = send(title, body)
    print(f"[digest] sent via {channels or 'nothing configured'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
