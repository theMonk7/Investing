"""Realised accuracy tracking.

The holdout AUC says how the model did on history. This says how it is doing
on *your* data, live, since you deployed it -- the number that actually
matters and the one most dashboards quietly omit.

Every prediction is stored when made. Once `horizon_days` of trading have
elapsed, the realised return is looked up and graded.

Grading matches the model's target: the prediction is "beats the median stock
over the horizon", so the outcome is the realised return minus the median
realised return **across the stocks predicted on that same date**. Grading a
relative prediction against absolute direction would be measuring the wrong
thing and would flatter the model in bull markets.

The stored column is still named `prob_up` for schema compatibility; it holds
the probability of outperforming.
"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta

import numpy as np

from store import conn


def _realised(cx, symbol: str, start: str, horizon: int) -> float | None:
    """Return over the next `horizon` trading days from the close on `start`."""
    rows = cx.execute(
        "SELECT date, close FROM prices WHERE symbol=? AND date>=? ORDER BY date LIMIT ?",
        (symbol, start, horizon + 1),
    ).fetchall()
    if len(rows) < horizon + 1:
        return None
    first, last = rows[0]["close"], rows[-1]["close"]
    if not first:
        return None
    return last / first - 1


def grade(lookback_days: int = 180) -> dict:
    """Grade every prediction old enough to have an outcome."""
    cutoff = (date.today() - timedelta(days=lookback_days)).isoformat()
    graded = []

    with conn() as cx:
        rows = cx.execute(
            "SELECT symbol, asof, horizon_days, prob_up, expected_move, confidence "
            "FROM predictions WHERE asof >= ? ORDER BY asof",
            (cutoff,),
        ).fetchall()

        raw: dict[str, list[dict]] = {}
        for r in rows:
            realised = _realised(cx, r["symbol"], r["asof"], r["horizon_days"])
            if realised is None:
                continue          # horizon has not elapsed yet
            raw.setdefault(r["asof"], []).append({
                "symbol": r["symbol"],
                "asof": r["asof"],
                "prob_outperform": r["prob_up"],
                "predicted_outperform": r["prob_up"] > 0.5,
                "realised_pct": round(realised * 100, 3),
                "expected_rel_pct": r["expected_move"],
                "confidence": r["confidence"],
                "_realised": realised,
            })

    # Grade each date against its own cross-section.
    for asof, day in raw.items():
        if len(day) < 5:
            continue              # too thin a cross-section to have a median
        median = float(np.median([d["_realised"] for d in day]))
        for d in day:
            d["median_realised_pct"] = round(median * 100, 3)
            d["excess_pct"] = round((d["_realised"] - median) * 100, 3)
            d["actual_outperform"] = d["_realised"] > median
            d["correct"] = d["predicted_outperform"] == d["actual_outperform"]
            d.pop("_realised")
            graded.append(d)
    graded.sort(key=lambda g: g["asof"])

    if not graded:
        return {
            "status": "no graded predictions yet",
            "note": ("Predictions need the full horizon in trading days to mature, "
                     "and at least 5 symbols graded on the same date to form a "
                     "cross-section. Check back after about a week of runs."),
            "n": 0,
        }

    probs = np.array([g["prob_outperform"] for g in graded])
    actual = np.array([1.0 if g["actual_outperform"] else 0.0 for g in graded])
    hits = np.array([g["correct"] for g in graded])

    by_conf = {}
    for level in ("high", "medium", "low"):
        subset = [g for g in graded if g["confidence"] == level]
        if subset:
            by_conf[level] = {
                "n": len(subset),
                "hit_rate": round(float(np.mean([g["correct"] for g in subset])), 4),
                "mean_excess_pct": round(float(np.mean([g["excess_pct"] for g in subset])), 3),
            }

    # Calibration: does "60% confident" actually win 60% of the time?
    bins, calibration = [(0.0, 0.45), (0.45, 0.5), (0.5, 0.55), (0.55, 1.0)], []
    for lo, hi in bins:
        mask = (probs >= lo) & (probs < hi)
        if mask.sum() >= 5:
            calibration.append({
                "bucket": f"{lo:.2f}-{hi:.2f}",
                "n": int(mask.sum()),
                "mean_predicted": round(float(probs[mask].mean()), 4),
                "actual_outperform_rate": round(float(actual[mask].mean()), 4),
            })

    picked = [g for g in graded if g["predicted_outperform"]]
    return {
        "status": "ok",
        "target": "outperform the median stock predicted on the same date",
        "n": len(graded),
        "hit_rate": round(float(hits.mean()), 4),
        "base_rate": round(float(actual.mean()), 4),
        "brier_score": round(float(np.mean((probs - actual) ** 2)), 4),
        "brier_baseline": round(float(np.mean((actual.mean() - actual) ** 2)), 4),
        "mean_excess_when_picked_pct": (
            round(float(np.mean([g["excess_pct"] for g in picked])), 3)
            if picked else None),
        "by_confidence": by_conf,
        "calibration": calibration,
        "first_graded": graded[0]["asof"],
        "last_graded": graded[-1]["asof"],
        "recent": graded[-40:],
        "note": (
            "Hit rate above the base rate (~0.50 by construction for a relative "
            "target) is the only thing that counts. Brier score below the "
            "baseline means the probabilities carry information; above it means "
            "they are worse than always guessing the base rate."
        ),
        "generated_at": datetime.now().isoformat(timespec="seconds"),
    }


if __name__ == "__main__":
    print(json.dumps(grade(), indent=2)[:3000])
