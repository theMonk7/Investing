"""Alert generation + phone delivery.

Channels are all free and all optional. Nothing here fails the pipeline: a
dead channel logs and moves on. Cooldowns live in SQLite so a repeating
condition does not spam the phone every 15 minutes.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from urllib.parse import quote

import requests

import config
from store import last_alert_ts, record_alert

SEVERITY_PRIORITY = {"high": "high", "medium": "default", "low": "low"}


# ---------------------------------------------------------------------------
# Rules
# ---------------------------------------------------------------------------

def build_alerts(cx, market: str, quotes: list[dict],
                 sentiments: dict[str, dict],
                 predictions: dict[str, dict],
                 watched: set[str]) -> list[dict]:
    """Only watchlist symbols raise alerts -- the scan pool would be noise."""
    now = datetime.now(timezone.utc)
    out: list[dict] = []

    def emit(sym, kind, severity, title, body):
        if _in_cooldown(cx, sym, kind, now):
            return
        out.append({"symbol": sym, "market": market, "kind": kind,
                    "severity": severity, "title": title, "body": body})

    for q in quotes:
        sym = q["symbol"]
        if sym not in watched:
            continue
        chg = q["change_pct"]

        if abs(chg) >= config.ALERT_PCT_MOVE:
            emit(sym, "price_move", "high" if abs(chg) >= 5 else "medium",
                 f"{sym} {chg:+.2f}%",
                 f"Close {q['close']} ({chg:+.2f}%). Volume {q['vol_z']:+.1f} SD, "
                 f"RSI {q['rsi14']:.0f}, ATR {q['atr_pct']:.1f}%.")

        if q["vol_z"] >= config.ALERT_VOLUME_Z:
            emit(sym, "volume_spike", "medium",
                 f"{sym} volume spike {q['vol_z']:.1f} SD",
                 f"Unusual volume with price {chg:+.2f}%. "
                 f"{'Accumulation' if chg > 0 else 'Distribution'} signature.")

        if q["rsi14"] >= config.ALERT_RSI_HIGH:
            emit(sym, "rsi_high", "low", f"{sym} RSI {q['rsi14']:.0f} (overbought)",
                 f"RSI {q['rsi14']:.0f}. Up {q['ret_20d']:+.1f}% in 20 days. "
                 f"Extended, not automatically a sell.")
        elif q["rsi14"] <= config.ALERT_RSI_LOW:
            emit(sym, "rsi_low", "low", f"{sym} RSI {q['rsi14']:.0f} (oversold)",
                 f"RSI {q['rsi14']:.0f}. Down {q['ret_20d']:+.1f}% in 20 days.")

        if q["pct_from_52w_hi"] > -0.5:
            emit(sym, "52w_high", "medium", f"{sym} at 52-week high",
                 f"Close {q['close']} vs 52w high {q['hi_52w']}. "
                 f"Volume {q['vol_z']:+.1f} SD.")
        if q["pct_from_52w_lo"] < 0.5:
            emit(sym, "52w_low", "medium", f"{sym} at 52-week low",
                 f"Close {q['close']} vs 52w low {q['lo_52w']}.")

        # 50/200 DMA cross -- only fires on the day it happens.
        if q["sma50"] and q["sma200"]:
            cross_up = q["close"] > q["sma200"] and q["prev_close"] <= q["sma200"]
            cross_dn = q["close"] < q["sma200"] and q["prev_close"] >= q["sma200"]
            if cross_up:
                emit(sym, "cross_200_up", "medium", f"{sym} reclaimed its 200-DMA",
                     f"Close {q['close']} crossed above 200-DMA {q['sma200']}.")
            elif cross_dn:
                emit(sym, "cross_200_dn", "medium", f"{sym} lost its 200-DMA",
                     f"Close {q['close']} fell below 200-DMA {q['sma200']}.")

        sent = sentiments.get(sym) or {}
        if abs(sent.get("score", 0)) >= config.ALERT_SENTIMENT_ABS and sent.get("count", 0) >= 3:
            emit(sym, "news_sentiment", "medium",
                 f"{sym} news turned {sent['label']}",
                 f"{sent['count']} stories, aggregate {sent['score']:+.2f} "
                 f"({sent['bullish']} positive / {sent['bearish']} negative).")

        pred = predictions.get(sym) or {}
        if pred.get("confidence") == "high":
            emit(sym, "model_signal", "medium",
                 f"{sym} model {pred['prob_outperform'] * 100:.0f}% to beat the "
                 f"median stock over {pred['horizon_days']}d",
                 f"Expected move vs median {pred['expected_rel_move_pct']:+.2f}%. "
                 f"Top driver: {pred['drivers'][0]['label']}. "
                 f"Model holdout AUC {pred.get('model_auc')}.")
    return out


def _in_cooldown(cx, symbol: str, kind: str, now: datetime) -> bool:
    prev = last_alert_ts(cx, symbol, kind)
    if not prev:
        return False
    try:
        prev_dt = datetime.fromisoformat(prev)
    except ValueError:
        return False
    if prev_dt.tzinfo is None:
        prev_dt = prev_dt.replace(tzinfo=timezone.utc)
    return now - prev_dt < timedelta(hours=config.ALERT_COOLDOWN_HOURS)


# ---------------------------------------------------------------------------
# Delivery
# ---------------------------------------------------------------------------

def _ntfy(alert: dict) -> bool:
    if not config.NTFY_TOPIC:
        return False
    try:
        resp = requests.post(
            f"{config.NTFY_SERVER}/{config.NTFY_TOPIC}",
            data=alert["body"].encode("utf-8"),
            headers={
                "Title": alert["title"],
                "Priority": SEVERITY_PRIORITY.get(alert["severity"], "default"),
                "Tags": _tag(alert),
            },
            timeout=config.HTTP_TIMEOUT,
        )
        return resp.ok
    except Exception as exc:  # noqa: BLE001
        print(f"[alerts] ntfy failed: {exc}")
        return False


def _tag(alert: dict) -> str:
    return {
        "price_move": "chart_with_upwards_trend", "volume_spike": "loudspeaker",
        "rsi_high": "fire", "rsi_low": "ice_cube", "52w_high": "rocket",
        "52w_low": "warning", "cross_200_up": "white_check_mark",
        "cross_200_dn": "x", "news_sentiment": "newspaper",
        "model_signal": "robot",
    }.get(alert["kind"], "bell")


def _telegram(alerts: list[dict]) -> bool:
    if not (config.TELEGRAM_BOT_TOKEN and config.TELEGRAM_CHAT_ID):
        return False
    lines = [f"*{_escape(a['title'])}*\n{_escape(a['body'])}" for a in alerts]
    text = "📈 *Market alerts*\n\n" + "\n\n".join(lines)
    try:
        resp = requests.post(
            f"https://api.telegram.org/bot{config.TELEGRAM_BOT_TOKEN}/sendMessage",
            json={"chat_id": config.TELEGRAM_CHAT_ID, "text": text[:4000],
                  "parse_mode": "MarkdownV2", "disable_web_page_preview": True},
            timeout=config.HTTP_TIMEOUT,
        )
        if not resp.ok:
            print(f"[alerts] telegram {resp.status_code}: {resp.text[:200]}")
        return resp.ok
    except Exception as exc:  # noqa: BLE001
        print(f"[alerts] telegram failed: {exc}")
        return False


def _escape(text: str) -> str:
    for ch in r"_*[]()~`>#+-=|{}.!":
        text = text.replace(ch, f"\\{ch}")
    return text


def _whatsapp(alerts: list[dict]) -> bool:
    """CallMeBot: free WhatsApp relay, one-time pairing, no Twilio account."""
    if not (config.CALLMEBOT_PHONE and config.CALLMEBOT_APIKEY):
        return False
    body = "Market alerts\n\n" + "\n\n".join(
        f"{a['title']}\n{a['body']}" for a in alerts[:6])
    try:
        resp = requests.get(
            "https://api.callmebot.com/whatsapp.php",
            params={"phone": config.CALLMEBOT_PHONE,
                    "text": body[:900], "apikey": config.CALLMEBOT_APIKEY},
            timeout=config.HTTP_TIMEOUT,
        )
        return resp.ok
    except Exception as exc:  # noqa: BLE001
        print(f"[alerts] whatsapp failed: {exc}")
        return False


def _discord(alerts: list[dict]) -> bool:
    if not config.DISCORD_WEBHOOK:
        return False
    try:
        resp = requests.post(
            config.DISCORD_WEBHOOK,
            json={"content": "**Market alerts**\n" + "\n".join(
                f"• **{a['title']}** — {a['body']}" for a in alerts[:10])[:1900]},
            timeout=config.HTTP_TIMEOUT,
        )
        return resp.ok
    except Exception as exc:  # noqa: BLE001
        print(f"[alerts] discord failed: {exc}")
        return False


def dispatch(cx, alerts: list[dict]) -> dict:
    """Persist first, then deliver. A delivery failure never loses the alert."""
    if not alerts:
        return {"sent": 0, "channels": []}

    ids = [record_alert(cx, a["symbol"], a["market"], a["kind"],
                        a["severity"], a["title"], a["body"]) for a in alerts]

    channels = []
    # ntfy is per-alert so each gets its own phone notification and priority.
    # Send them all even if one fails, rather than short-circuiting.
    if config.NTFY_TOPIC:
        results = [_ntfy(a) for a in alerts[:15]]
        if any(results):
            channels.append("ntfy")
        if not all(results):
            print(f"[alerts] ntfy delivered {sum(results)}/{len(results)}")
    if _telegram(alerts):
        channels.append("telegram")
    if _whatsapp(alerts):
        channels.append("whatsapp")
    if _discord(alerts):
        channels.append("discord")

    if channels:
        from store import mark_delivered
        mark_delivered(cx, ids)
    else:
        print("[alerts] no channel configured or all failed; alerts stored only")
    return {"sent": len(alerts), "channels": channels}
