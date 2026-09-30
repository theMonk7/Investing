"""Market regime, sector rotation, and "what could move next" scanning."""
from __future__ import annotations

import numpy as np
import pandas as pd

from technicals import enrich
from universe import sector_of


def market_regime(bench_df: pd.DataFrame, vix_df: pd.DataFrame | None,
                  quotes: list[dict]) -> dict:
    """Breadth + trend + volatility, combined into one readable regime."""
    if bench_df.empty:
        return {"regime": "unknown", "note": "benchmark data unavailable"}

    e = enrich(bench_df)
    last = e.iloc[-1]
    close = float(last["close"])
    above_50 = bool(close > (last["sma50"] or close))
    above_200 = bool(close > (last["sma200"] or close))

    breadth_up = sum(1 for q in quotes if q.get("change_pct", 0) > 0)
    breadth_pct = round(breadth_up / len(quotes) * 100, 1) if quotes else 0.0
    above_sma50_pct = round(
        sum(1 for q in quotes if q.get("close", 0) > q.get("sma50", 1e18))
        / len(quotes) * 100, 1) if quotes else 0.0

    vix_val = vix_chg = None
    if vix_df is not None and not vix_df.empty:
        vix_val = round(float(vix_df["close"].iloc[-1]), 2)
        if len(vix_df) > 1:
            prev = float(vix_df["close"].iloc[-2])
            vix_chg = round((vix_val - prev) / prev * 100, 2) if prev else None

    if above_50 and above_200 and above_sma50_pct > 55:
        regime = "Risk-on / broad uptrend"
    elif above_200 and above_sma50_pct > 40:
        regime = "Uptrend, narrowing participation"
    elif not above_200 and above_sma50_pct < 35:
        regime = "Risk-off / broad downtrend"
    elif not above_200:
        regime = "Corrective / below long-term trend"
    else:
        regime = "Mixed / range-bound"

    return {
        "regime": regime,
        "index_close": round(close, 2),
        "index_change_pct": round(float(last["ret_1d"] or 0) * 100, 2),
        "index_ret_20d": round(float(last["ret_20d"] or 0) * 100, 2),
        "above_sma50": above_50,
        "above_sma200": above_200,
        "index_rsi14": round(float(last["rsi14"] or 50), 1),
        "advancers_pct": breadth_pct,
        "pct_above_sma50": above_sma50_pct,
        "vix": vix_val,
        "vix_change_pct": vix_chg,
        "realised_vol_20d": round(float(last["vol_20d"] or 0) * 100, 1),
    }


def sector_rotation(quotes: list[dict], market: str) -> list[dict]:
    """Equal-weight sector aggregates -- what money rotated into, and when."""
    buckets: dict[str, list[dict]] = {}
    for q in quotes:
        buckets.setdefault(sector_of(q["symbol"]), []).append(q)

    rows = []
    for name, members in buckets.items():
        if name == "Other" or len(members) < 2:
            continue
        rows.append({
            "sector": name,
            "members": len(members),
            "ret_1d": round(float(np.mean([m["change_pct"] for m in members])), 2),
            "ret_5d": round(float(np.mean([m["ret_5d"] for m in members])), 2),
            "ret_20d": round(float(np.mean([m["ret_20d"] for m in members])), 2),
            "avg_rsi": round(float(np.mean([m["rsi14"] for m in members])), 1),
            "leaders": [m["symbol"] for m in
                        sorted(members, key=lambda x: -x["ret_5d"])[:3]],
            "laggards": [m["symbol"] for m in
                         sorted(members, key=lambda x: x["ret_5d"])[:3]],
        })
    return sorted(rows, key=lambda r: -r["ret_5d"])


def _setup_scan(q: dict, sector_ret5: float) -> tuple[float, list[str], str]:
    """Transparent additive score. Every point is traceable to one condition."""
    score, reasons = 0.0, []
    close, sma50, sma200 = q["close"], q["sma50"], q["sma200"]
    rsi, vol_z, pctb = q["rsi14"], q["vol_z"], q["bb_pctb"]

    if close > sma50 > sma200:
        score += 2.0
        reasons.append("price above rising 50-DMA and 200-DMA (trend intact)")
    elif close < sma50 < sma200:
        score -= 2.0
        reasons.append("price below 50-DMA and 200-DMA (downtrend)")

    if vol_z >= 2.0:
        score += 1.5 if q["change_pct"] > 0 else -1.5
        reasons.append(f"volume {vol_z:.1f} SD above 20-day average "
                       f"({'buying' if q['change_pct'] > 0 else 'selling'} pressure)")

    if q["pct_from_52w_hi"] > -3 and q["pct_from_52w_hi"] <= 0:
        score += 1.5
        reasons.append("within 3% of 52-week high (breakout watch)")
    if q["pct_from_52w_lo"] < 5:
        score -= 1.0
        reasons.append("near 52-week low")

    if 55 <= rsi <= 70:
        score += 1.0
        reasons.append(f"RSI {rsi:.0f} — momentum without being overbought")
    elif rsi > 75:
        score -= 1.0
        reasons.append(f"RSI {rsi:.0f} — overbought, pullback risk")
    elif rsi < 30:
        score += 0.5
        reasons.append(f"RSI {rsi:.0f} — oversold, mean-reversion candidate")

    if q["macd_hist"] > 0:
        score += 0.8
        reasons.append("MACD histogram positive (momentum turning up)")
    else:
        score -= 0.5

    if sector_ret5 > 2:
        score += 1.0
        reasons.append(f"sector up {sector_ret5:.1f}% over 5 days (tailwind)")
    elif sector_ret5 < -2:
        score -= 0.8
        reasons.append(f"sector down {sector_ret5:.1f}% over 5 days (headwind)")

    if pctb > 0.95:
        reasons.append("riding upper Bollinger band — extended")
    elif pctb < 0.05:
        reasons.append("pinned to lower Bollinger band — capitulation or support")

    if q["atr_pct"] > 4:
        reasons.append(f"high volatility ({q['atr_pct']:.1f}% ATR) — size positions smaller")

    if score >= 3.5:
        bias = "bullish setup"
    elif score <= -3.0:
        bias = "bearish setup"
    else:
        bias = "no clear edge"
    return score, reasons, bias


def candidates(quotes: list[dict], sectors: list[dict],
               predictions: dict[str, dict], top_n: int = 12) -> list[dict]:
    """Ranked "could move" list. Scores and reasons are both shown in the UI."""
    sector_ret = {s["sector"]: s["ret_5d"] for s in sectors}
    rows = []
    for q in quotes:
        sec = sector_of(q["symbol"])
        score, reasons, bias = _setup_scan(q, sector_ret.get(sec, 0.0))
        pred = predictions.get(q["symbol"]) or {}
        prob = pred.get("prob_outperform")
        # Model probability nudges the technical score; it never overrides it.
        combined = score + ((prob - 0.5) * 8 if prob is not None else 0)
        rows.append({
            "symbol": q["symbol"],
            "name": q.get("name", q["symbol"]),
            "sector": sec,
            "change_pct": q["change_pct"],
            "close": q["close"],
            "setup_score": round(score, 2),
            "combined_score": round(combined, 2),
            "bias": bias,
            "reasons": reasons,
            "prob_outperform": prob,
            "confidence": pred.get("confidence"),
            "expected_rel_move_pct": pred.get("expected_rel_move_pct"),
            "atr_pct": q["atr_pct"],
        })

    ranked = sorted(rows, key=lambda r: -r["combined_score"])
    return {
        "bullish": ranked[:top_n],
        "bearish": sorted(rows, key=lambda r: r["combined_score"])[:top_n],
        "volume_surges": sorted(
            [r for r in rows if abs(r["change_pct"]) > 0],
            key=lambda r: -next(q["vol_z"] for q in quotes if q["symbol"] == r["symbol"]),
        )[:8],
    }


def top_movers(quotes: list[dict], n: int = 8) -> dict:
    by_chg = sorted(quotes, key=lambda q: -q["change_pct"])
    return {
        "gainers": [_slim(q) for q in by_chg[:n]],
        "losers": [_slim(q) for q in by_chg[-n:]][::-1],
        "most_active": [_slim(q) for q in
                        sorted(quotes, key=lambda q: -q["vol_z"])[:n]],
        "near_52w_high": [_slim(q) for q in quotes
                          if q["pct_from_52w_hi"] > -2][:n],
        "near_52w_low": [_slim(q) for q in quotes
                         if q["pct_from_52w_lo"] < 3][:n],
    }


def _slim(q: dict) -> dict:
    return {k: q[k] for k in
            ("symbol", "name", "close", "change_pct", "volume", "rsi14",
             "vol_z", "ret_5d", "atr_pct")}
