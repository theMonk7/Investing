"""Quarterly results, earnings surprises and analyst views for the calendar.

Source: Yahoo Finance via yfinance -- the quarterly income statement, EPS
estimate vs reported for past result dates, and the analyst consensus.
How the stock moved around each past result is measured from our own price
history, not taken from anywhere.

Each symbol is cached in SQLite meta with a fetch time, so a run refreshes only
what is stale (more often around a results date, when the numbers change).
data/<market>/fundamentals.json is re-exported on every news/full/quick run.
"""
from __future__ import annotations

import math
import statistics
import time
from collections import Counter
from datetime import date, datetime, timedelta, timezone

import pandas as pd

from store import corp_events_between, get_meta, set_meta

TTL_HOURS = 20
HOT_TTL_HOURS = 4          # results due or just out
MAX_PER_RUN = 25
KEEP_DAYS = 30
MARKET_TZ = {"IN": "Asia/Kolkata", "US": "America/New_York"}
MARKET_CLOSE = {"IN": (15, 30), "US": (16, 0)}

# First label present wins; Yahoo's row names differ a little by company.
ROWS = {
    "revenue": ("Total Revenue", "Operating Revenue"),
    "op_income": ("Operating Income", "Total Operating Income As Reported", "EBIT"),
    "net_income": ("Net Income", "Net Income Common Stockholders"),
    "eps": ("Diluted EPS", "Basic EPS"),
}


def _num(v) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) or math.isinf(f) else f


def _growth(new, old) -> float | None:
    if new is None or old is None or old == 0:
        return None
    return round((new - old) / abs(old) * 100, 1)


def _pct(v) -> float | None:
    v = _num(v)
    return None if v is None else round(v * 100, 2)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# --- statements ----------------------------------------------------------------

def quarters_from(stmt: pd.DataFrame | None, n: int = 6) -> list[dict]:
    """Newest-first quarters with revenue, operating income, profit, EPS, margin."""
    if stmt is None or stmt.empty:
        return []
    rows = []
    for col in sorted(stmt.columns, reverse=True):
        row = {"period": pd.Timestamp(col).date().isoformat()}
        for key, labels in ROWS.items():
            row[key] = next((v for label in labels if label in stmt.index
                             and (v := _num(stmt.at[label, col])) is not None), None)
        row["op_margin"] = (round(row["op_income"] / row["revenue"] * 100, 2)
                            if row["revenue"] and row["op_income"] is not None else None)
        if row["revenue"] is not None or row["net_income"] is not None:
            rows.append(row)
    # Yahoo sometimes copies one quarter's figures into another period. Two
    # quarters cannot match to the rupee, and we cannot tell which is real,
    # so both are dropped rather than skewing QoQ / YoY.
    sig = lambda r: (r["revenue"], r["op_income"], r["net_income"])  # noqa: E731
    seen = Counter(sig(r) for r in rows if r["revenue"] is not None)
    return [r for r in rows if r["revenue"] is None or seen[sig(r)] == 1][:n]


def _year_ago(quarters: list[dict]) -> dict:
    cur = date.fromisoformat(quarters[0]["period"])
    return next((q for q in quarters[1:]
                 if abs((cur - date.fromisoformat(q["period"])).days - 365) <= 20), {})


def summarise(quarters: list[dict]) -> dict:
    """Latest quarter against the one before and the same quarter last year."""
    if not quarters:
        return {}
    cur, prev, yago = quarters[0], (quarters[1] if len(quarters) > 1 else {}), _year_ago(quarters)
    margin_chg = lambda other: (round(cur["op_margin"] - other["op_margin"], 2)  # noqa: E731
                                if cur.get("op_margin") is not None
                                and other.get("op_margin") is not None else None)
    return {
        "period": cur["period"],
        "rev_yoy": _growth(cur.get("revenue"), yago.get("revenue")),
        "rev_qoq": _growth(cur.get("revenue"), prev.get("revenue")),
        "ni_yoy": _growth(cur.get("net_income"), yago.get("net_income")),
        "ni_qoq": _growth(cur.get("net_income"), prev.get("net_income")),
        "eps_yoy": _growth(cur.get("eps"), yago.get("eps")),
        "op_margin": cur.get("op_margin"),
        "margin_chg_yoy": margin_chg(yago),
        "margin_chg_qoq": margin_chg(prev),
    }


# --- price reaction around a results date -------------------------------------

def reaction(df: pd.DataFrame | None, day: date, after_close: bool | None) -> dict:
    """Close before the news to the first close after it, plus 5 sessions on.

    after_close None means the time of day is unknown, so the window spans the
    whole results day (close before it to close after it).
    """
    if df is None or df.empty:
        return {}
    idx, close = df.index, df["close"].to_numpy()
    d = pd.Timestamp(day)
    if after_close:
        base = idx.searchsorted(d, side="right") - 1
        react = base + 1
    else:
        base = idx.searchsorted(d, side="left") - 1
        react = idx.searchsorted(d, side="right") if after_close is None else base + 1
    if base < 0 or react >= len(idx) or (idx[react] - d).days > 7:
        return {}
    out = {"move_pct": round(float(close[react] / close[base] - 1) * 100, 2)}
    if react + 4 < len(idx):
        out["drift_5d_pct"] = round(float(close[react + 4] / close[base] - 1) * 100, 2)
    return out


def _after_close(ts: pd.Timestamp, market: str) -> bool | None:
    if ts.hour == 0 and ts.minute == 0:
        return None
    return (ts.hour, ts.minute) >= MARKET_CLOSE[market]


def surprises_from(ed: pd.DataFrame | None, market: str, df: pd.DataFrame | None,
                   past_dates: list[str] = ()) -> tuple[list[dict], dict | None]:
    """Reported quarters (newest first) with surprise and price move, and the next date."""
    rows, upcoming = [], None
    now = pd.Timestamp.now(tz="UTC")
    if ed is not None and not ed.empty:
        for ts, r in ed.iterrows():
            ts = pd.Timestamp(ts)
            ts = ts.tz_localize("UTC") if ts.tzinfo is None else ts
            local = ts.tz_convert(MARKET_TZ[market])
            est, act = _num(r.get("EPS Estimate")), _num(r.get("Reported EPS"))
            if act is None:
                if ts >= now - pd.Timedelta(days=1) and (upcoming is None or local.date().isoformat() < upcoming["date"]):
                    upcoming = {"date": local.date().isoformat(), "eps_estimate": est}
                continue
            sur = _num(r.get("Surprise(%)"))
            if sur is None and est:
                sur = (act - est) / abs(est) * 100
            row = {"date": local.date().isoformat(), "estimate": est, "actual": act,
                   "surprise_pct": None if sur is None else round(sur, 2)}
            row.update(reaction(df, local.date(), _after_close(local, market)))
            rows.append(row)
    # Exchange filings fill in dates Yahoo has no estimates for.
    seen = {date.fromisoformat(r["date"]) for r in rows}
    for d in past_dates:
        day = date.fromisoformat(d)
        if any(abs((day - s).days) <= 5 for s in seen):
            continue
        rows.append({"date": d, "estimate": None, "actual": None, "surprise_pct": None,
                     **reaction(df, day, None)})
        seen.add(day)
    rows.sort(key=lambda r: r["date"], reverse=True)
    return rows[:12], upcoming


def reaction_stats(rows: list[dict]) -> dict:
    moves = [r["move_pct"] for r in rows if r.get("move_pct") is not None]
    rated = [r for r in rows if r.get("surprise_pct") is not None]
    beats = [r for r in rated if r["surprise_pct"] > 0]
    misses = [r for r in rated if r["surprise_pct"] < 0]
    avg = lambda xs: round(statistics.fmean(xs), 2) if xs else None  # noqa: E731
    return {
        "n": len(moves),
        "up": int(sum(m > 0 for m in moves)),
        "avg_move": avg(moves),
        "typical_abs_move": round(statistics.median(abs(m) for m in moves), 2) if moves else None,
        "rated": len(rated),
        "beats": len(beats),
        "misses": len(misses),
        "avg_surprise": avg([r["surprise_pct"] for r in rated]),
        "avg_move_beat": avg([r["move_pct"] for r in beats if r.get("move_pct") is not None]),
        "avg_move_miss": avg([r["move_pct"] for r in misses if r.get("move_pct") is not None]),
    }


# --- analysts and valuation ------------------------------------------------------

def analysts_from(info: dict, price: float | None) -> dict:
    target = _num(info.get("targetMeanPrice"))
    price = price or _num(info.get("currentPrice"))
    count = _num(info.get("numberOfAnalystOpinions"))
    rating = info.get("recommendationKey")
    return {
        "rating": None if rating in (None, "none") else rating,
        "score": _num(info.get("recommendationMean")),
        "count": int(count) if count else None,
        "target_mean": target,
        "target_high": _num(info.get("targetHighPrice")),
        "target_low": _num(info.get("targetLowPrice")),
        "upside_pct": _growth(target, price),
    }


def valuation_from(info: dict) -> dict:
    return {
        "pe": _num(info.get("trailingPE")),
        "forward_pe": _num(info.get("forwardPE")),
        "profit_margin": _pct(info.get("profitMargins")),
        "roe": _pct(info.get("returnOnEquity")),
        "debt_to_equity": _num(info.get("debtToEquity")),
        "revenue_growth": _pct(info.get("revenueGrowth")),
        "earnings_growth": _pct(info.get("earningsGrowth")),
        "dividend_yield": _num(info.get("dividendYield")),   # yfinance already gives %
        "market_cap": _num(info.get("marketCap")),
    }


def collect(symbol: str, market: str, df: pd.DataFrame | None,
            past_dates: list[str] = ()) -> dict | None:
    import yfinance as yf

    t = yf.Ticker(symbol)
    rec = {"symbol": symbol, "fetched_at": utc_now()}
    try:
        rec["quarters"] = quarters_from(t.quarterly_income_stmt)
    except Exception:  # noqa: BLE001 -- each piece is optional
        rec["quarters"] = []
    rec["summary"] = summarise(rec["quarters"])
    try:
        ed = t.get_earnings_dates(limit=16)
    except Exception:  # noqa: BLE001
        ed = None
    rec["history"], rec["next"] = surprises_from(ed, market, df, past_dates)
    rec["reactions"] = reaction_stats(rec["history"])
    try:
        info = t.get_info() or {}
    except Exception:  # noqa: BLE001
        info = {}
    price = float(df["close"].iloc[-1]) if df is not None and not df.empty else None
    rec["analysts"] = analysts_from(info, price)
    rec["valuation"] = valuation_from(info)
    rec["name"] = info.get("shortName") or info.get("longName")
    # ADR filers (e.g. Infosys) report statements in USD while EPS estimates follow the listing.
    rec["statement_currency"] = info.get("financialCurrency")
    rec["currency"] = info.get("currency")
    useful = rec["quarters"] or rec["history"] or rec["analysts"]["target_mean"]
    return rec if useful else None


# --- orchestration ---------------------------------------------------------------

def _age_hours(stamp: str | None) -> float:
    if not stamp:
        return float("inf")
    return (datetime.now(timezone.utc) - datetime.fromisoformat(stamp)).total_seconds() / 3600


def refresh(cx, market: str, histories: dict, watched, force=()) -> dict:
    """Refresh stale entries for the watchlist, results due soon, and `force`."""
    key = f"fundamentals:{market}"
    cache = get_meta(cx, key, {})
    today = date.today()
    results: dict[str, list[date]] = {}
    for e in corp_events_between(cx, market, (today - timedelta(400)).isoformat(),
                                 (today + timedelta(21)).isoformat()):
        if "results" in e["types"]:
            results.setdefault(e["symbol"], []).append(date.fromisoformat(e["date"]))

    near = {s for s, days in results.items() if any(-7 <= (d - today).days <= 21 for d in days)}
    force = set(force)
    wanted = ((set(watched) | near) & set(histories)) | force

    def stale(sym):
        hot = any(-3 <= (d - today).days <= 1 for d in results.get(sym, []))
        return _age_hours(cache.get(sym, {}).get("fetched_at")) > (HOT_TTL_HOURS if hot else TTL_HOURS)

    todo = sorted((s for s in wanted - force if stale(s)),
                  key=lambda s: cache.get(s, {}).get("fetched_at") or "")
    # Forced (asked for on demand) still skips anything fetched in the last hour.
    forced = sorted(s for s in force if _age_hours(cache.get(s, {}).get("fetched_at")) > 1)
    todo = forced + todo[:MAX_PER_RUN]
    for sym in todo:
        past = sorted({d.isoformat() for d in results.get(sym, []) if d < today}, reverse=True)
        try:
            rec = collect(sym, market, histories.get(sym), past)
        except Exception as exc:  # noqa: BLE001 -- one symbol must not sink the rest
            print(f"[fundamentals] {sym} failed: {exc}")
            continue
        if rec:
            cache[sym] = rec
        time.sleep(0.3)

    cache = {s: v for s, v in cache.items()
             if s in wanted or _age_hours(v.get("fetched_at")) < KEEP_DAYS * 24}
    set_meta(cx, key, cache)
    print(f"[{market}] fundamentals: {len(todo)} refreshed, {len(cache)} cached")
    return cache


def payload(market: str, items: dict) -> dict:
    return {"market": market, "generated_at": utc_now(), "items": items}
