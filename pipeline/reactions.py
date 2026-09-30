"""How stocks actually moved after each kind of news event.

This is the honest substitute for a news backtest. No free multi-year news
archive exists, so nothing here can be computed retrospectively at install
time -- instead every classified event is logged when it happens and graded
once the price history catches up. The table therefore starts empty and fills
in over weeks of scheduled runs.

What it answers: "when this dashboard has seen an `upgrade` on an Indian
stock, what did the stock do over the next 1, 3 and 5 sessions, on average?"
That is a measured statement about a small sample, not a prediction, and the
sample size is always shown alongside it.
"""
from __future__ import annotations

import statistics
from datetime import datetime, timezone

from events import EVENT_MEANING, EVENT_TONE

MIN_SAMPLE = 8          # below this, report the count and refuse to average


def log_from_news(cx, items: list[dict], market: str) -> int:
    """Record every classified, ticker-attributed event for later grading."""
    from events import event_id

    rows, seen = [], set()
    for it in items:
        event_type = it.get("event_type")
        tickers = it.get("tickers") or []
        if not event_type or not tickers:
            continue
        date = (it.get("published") or "")[:10]
        if not date:
            continue
        for sym in tickers[:3]:          # a story about five names is market noise
            key = event_id(sym, event_type, date)
            if key in seen:
                continue
            seen.add(key)
            rows.append({
                "id": key, "symbol": sym, "market": market,
                "event_type": event_type, "date": date,
                "sentiment": float(it.get("sentiment") or 0.0),
                "headline": (it.get("title") or "")[:300],
            })

    from store import log_events
    log_events(cx, rows)
    return len(rows)


def grade_pending(cx) -> int:
    """Fill in forward returns for events whose window has now elapsed."""
    pending = cx.execute(
        "SELECT id, symbol, date FROM event_log WHERE graded=0"
    ).fetchall()

    graded = 0
    for row in pending:
        prices = cx.execute(
            "SELECT date, close FROM prices WHERE symbol=? AND date>=? "
            "ORDER BY date LIMIT 6",
            (row["symbol"], row["date"]),
        ).fetchall()
        if len(prices) < 6:
            continue                     # not enough forward history yet
        base = prices[0]["close"]
        if not base:
            continue

        def ret(n: int) -> float:
            return round((prices[n]["close"] / base - 1) * 100, 3)

        cx.execute(
            "UPDATE event_log SET ret_1d=?, ret_3d=?, ret_5d=?, graded=1 WHERE id=?",
            (ret(1), ret(3), ret(5), row["id"]),
        )
        graded += 1
    return graded


def summarise(cx, market: str | None = None) -> list[dict]:
    """Per-event-type aggregates over everything graded so far."""
    sql = ("SELECT event_type, ret_1d, ret_3d, ret_5d FROM event_log "
           "WHERE graded=1 AND ret_5d IS NOT NULL")
    params: list = []
    if market:
        sql += " AND market=?"
        params.append(market)

    buckets: dict[str, list[tuple[float, float, float]]] = {}
    for row in cx.execute(sql, params).fetchall():
        buckets.setdefault(row["event_type"], []).append(
            (row["ret_1d"], row["ret_3d"], row["ret_5d"]))

    out = []
    for event_type, rows in buckets.items():
        n = len(rows)
        entry = {
            "event_type": event_type,
            "label": event_type.replace("_", " "),
            "meaning": EVENT_MEANING.get(event_type, ""),
            "expected_tone": EVENT_TONE.get(event_type),
            "n": n,
            "reliable": n >= MIN_SAMPLE,
        }
        if n >= MIN_SAMPLE:
            for idx, horizon in enumerate(("1d", "3d", "5d")):
                values = [r[idx] for r in rows]
                entry[f"mean_{horizon}"] = round(statistics.fmean(values), 3)
                entry[f"median_{horizon}"] = round(statistics.median(values), 3)
            entry["hit_rate_5d"] = round(
                sum(1 for r in rows if r[2] > 0) / n, 3)
        out.append(entry)

    return sorted(out, key=lambda e: (-e["n"], e["event_type"]))


def catalysts(cx, market: str, quotes_by_symbol: dict, days: int = 3,
              limit: int = 25) -> list[dict]:
    """Recent high-impact events on tracked stocks, newest first.

    Each is paired with the measured reaction for that event type when the
    sample is large enough. The pairing is explicitly labelled as historical
    average, never as a forecast for this instance.
    """
    from events import HIGH_IMPACT

    stats = {s["event_type"]: s for s in summarise(cx, market)}
    rows = cx.execute(
        "SELECT symbol, event_type, date, sentiment, headline FROM event_log "
        "WHERE market=? AND date >= date('now', ?) ORDER BY date DESC",
        (market, f"-{days} days"),
    ).fetchall()

    out = []
    for row in rows:
        if row["event_type"] not in HIGH_IMPACT:
            continue
        quote = quotes_by_symbol.get(row["symbol"])
        if not quote:
            continue
        stat = stats.get(row["event_type"], {})
        out.append({
            "symbol": row["symbol"],
            "name": quote.get("name", row["symbol"]),
            "sector": quote.get("sector"),
            "event_type": row["event_type"],
            "label": row["event_type"].replace("_", " "),
            "meaning": EVENT_MEANING.get(row["event_type"], ""),
            "expected_tone": EVENT_TONE.get(row["event_type"]),
            "date": row["date"],
            "headline": row["headline"],
            "sentiment": round(row["sentiment"], 3),
            "change_pct": quote.get("change_pct"),
            "vol_z": quote.get("vol_z"),
            "rsi14": quote.get("rsi14"),
            # Measured history for this event type, or an honest null.
            "historical_mean_5d": stat.get("mean_5d"),
            "historical_hit_rate_5d": stat.get("hit_rate_5d"),
            "historical_n": stat.get("n", 0),
            "historical_reliable": stat.get("reliable", False),
        })
        if len(out) >= limit:
            break
    return out


def status(cx) -> dict:
    total = cx.execute("SELECT COUNT(*) FROM event_log").fetchone()[0]
    graded = cx.execute("SELECT COUNT(*) FROM event_log WHERE graded=1").fetchone()[0]
    return {
        "logged": total,
        "graded": graded,
        "pending": total - graded,
        "min_sample": MIN_SAMPLE,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "note": (
            "Events are logged when seen and graded once five sessions of "
            "forward prices exist. Averages appear only past "
            f"{MIN_SAMPLE} observations, and even then describe a small sample "
            "of this dashboard's own history -- not a backtest."
        ),
    }
