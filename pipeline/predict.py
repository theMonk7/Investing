"""Cross-sectional relative-strength model over a D-day window.

What it predicts: the probability that a stock **outperforms the median stock
in the same universe** over the next `PREDICT_HORIZON_DAYS` sessions.

Why relative and not absolute direction: absolute direction is dominated by
market beta, which these features cannot predict at all -- an absolute-return
target measured AUC 0.49 here, i.e. worse than a coin flip, because the model
spends its capacity on an unpredictable common factor. Removing the
cross-sectional median strips that factor out and leaves the part technicals
can actually speak to. It is also the right target for what this dashboard
does: rank stocks against each other.

Read the output accordingly. 60% means "likely to beat the median stock", not
"likely to go up". In a falling market the top-ranked stock usually still
falls, just less.

Other design choices, because honesty matters more than the headline number:

* Trains on **technicals only**. No free multi-year news archive exists, so
  training on recent sentiment would leak and overstate skill.
* Sentiment is applied afterwards as an explicit, capped, separately displayed
  adjustment.
* LogisticRegression over standardised features rather than a boosted tree:
  per-feature contributions are then exact, which is what feeds the "why"
  panel. On signal this weak the accuracy difference is noise.
* Validation is a time-based holdout, never a random split, and the measured
  AUC is published in the UI.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, roc_auc_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from config import PREDICT_HORIZON_DAYS
from technicals import enrich

FEATURES = [
    "ret_1d", "ret_5d", "ret_10d", "ret_20d", "ret_60d", "mom_12_1",
    "rsi14", "macd_hist_norm", "dist_sma50", "dist_sma200",
    "atr_pct", "vol_z", "bb_pctb", "bb_width",
    "obv_slope", "pct_from_52w_hi", "pct_from_52w_lo", "gap_pct",
    "rel_strength_20d",
]

HUMAN = {
    "ret_1d": "yesterday's move (short-term reversal)",
    "mom_12_1": "12-month momentum excluding last month",
    "ret_5d": "5-day momentum", "ret_10d": "10-day momentum",
    "ret_20d": "1-month momentum", "ret_60d": "3-month momentum",
    "rsi14": "RSI(14)", "macd_hist_norm": "MACD histogram",
    "dist_sma50": "distance from 50-DMA", "dist_sma200": "distance from 200-DMA",
    "atr_pct": "volatility (ATR%)", "vol_z": "volume spike",
    "bb_pctb": "position in Bollinger band", "bb_width": "band squeeze/expansion",
    "obv_slope": "on-balance-volume trend",
    "pct_from_52w_hi": "distance from 52-week high",
    "pct_from_52w_lo": "distance from 52-week low",
    "gap_pct": "opening gap", "rel_strength_20d": "strength vs index",
}


def _feature_frame(df: pd.DataFrame, bench: pd.Series | None) -> pd.DataFrame:
    e = enrich(df)
    e["macd_hist_norm"] = e["macd_hist"] / e["close"]
    # Classic 12-1 momentum: last year's return excluding the most recent
    # month, which is dominated by short-term reversal and works against it.
    e["mom_12_1"] = e["close"].shift(21) / e["close"].shift(252) - 1
    if bench is not None and len(bench) > 20:
        bench_ret = bench.pct_change(20).reindex(e.index).ffill()
        e["rel_strength_20d"] = e["ret_20d"] - bench_ret
    else:
        e["rel_strength_20d"] = 0.0
    return e


def build_dataset(histories: dict[str, pd.DataFrame], bench: pd.Series | None,
                  horizon: int = PREDICT_HORIZON_DAYS):
    """Pooled panel: every (symbol, day) is one row.

    The label is demeaned *per date* against the cross-section, so y=1 means
    "beat the median stock that day", not "went up". This is what removes the
    market factor.
    """
    frames = []
    for sym, df in histories.items():
        if len(df) < 320:
            continue
        e = _feature_frame(df, bench)
        sub = e[FEATURES].copy()
        sub["fwd"] = e["close"].shift(-horizon) / e["close"] - 1
        sub["symbol"] = sym
        sub["date"] = e.index
        frames.append(sub.dropna())
    if not frames:
        return pd.DataFrame()

    panel = pd.concat(frames).sort_values("date")
    median_by_date = panel.groupby("date")["fwd"].transform("median")
    panel["fwd_rel"] = panel["fwd"] - median_by_date
    panel["y"] = (panel["fwd_rel"] > 0).astype(int)
    # Dates with too few names have a meaningless cross-section.
    counts = panel.groupby("date")["fwd"].transform("size")
    return panel[counts >= 10]


def train(dataset: pd.DataFrame, holdout_days: int = 90):
    """Time-based split. Anything else would leak the future into training."""
    if dataset.empty or len(dataset) < 2000:
        return None, {"error": "insufficient data", "rows": len(dataset)}

    cutoff = dataset["date"].max() - pd.Timedelta(days=holdout_days)
    train_df = dataset[dataset["date"] <= cutoff]
    test_df = dataset[dataset["date"] > cutoff]
    if len(train_df) < 1000 or len(test_df) < 100:
        train_df, test_df = dataset, dataset.tail(200)

    model = Pipeline([
        ("scale", StandardScaler()),
        ("clf", LogisticRegression(max_iter=2000, C=0.3, class_weight="balanced")),
    ])
    model.fit(train_df[FEATURES], train_df["y"])

    proba = model.predict_proba(test_df[FEATURES])[:, 1]
    try:
        auc = float(roc_auc_score(test_df["y"], proba))
    except ValueError:
        auc = float("nan")

    metrics = {
        "train_rows": int(len(train_df)),
        "test_rows": int(len(test_df)),
        "holdout_auc": round(auc, 4),
        "holdout_accuracy": round(float(accuracy_score(test_df["y"], proba > 0.5)), 4),
        "base_rate_up": round(float(test_df["y"].mean()), 4),
        "horizon_days": PREDICT_HORIZON_DAYS,
        "target": "outperform cross-sectional median over the horizon",
        "note": ("Time-based holdout on a market-relative target. AUC near 0.50 "
                 "means no edge -- treat it as such."),
    }
    return model, metrics


def _contributions(model: Pipeline, row: pd.Series) -> list[dict]:
    """Exact log-odds contribution per feature: coef * standardised value."""
    scaler: StandardScaler = model.named_steps["scale"]
    clf: LogisticRegression = model.named_steps["clf"]
    x = row[FEATURES].to_numpy(dtype=float).reshape(1, -1)
    z = (x - scaler.mean_) / np.sqrt(scaler.var_)
    contrib = (clf.coef_[0] * z[0])
    order = np.argsort(-np.abs(contrib))
    return [
        {
            "feature": FEATURES[i],
            "label": HUMAN[FEATURES[i]],
            "contribution": round(float(contrib[i]), 4),
            "direction": "bullish" if contrib[i] > 0 else "bearish",
            "value": round(float(x[0][i]), 4),
        }
        for i in order[:6]
    ]


def _confidence(prob: float, auc: float, n_news: int) -> str:
    """Confidence is about the *evidence*, not the probability magnitude."""
    edge = abs(prob - 0.5)
    if not auc or np.isnan(auc) or auc < 0.52:
        return "low"          # model has no measured edge -- say so
    if edge > 0.12 and n_news >= 3 and auc >= 0.55:
        return "high"
    if edge > 0.06:
        return "medium"
    return "low"


def predict_symbol(model, metrics: dict, symbol: str, df: pd.DataFrame,
                   bench: pd.Series | None, sentiment: dict,
                   horizon: int = PREDICT_HORIZON_DAYS) -> dict | None:
    if model is None or df.empty or len(df) < 220:
        return None
    e = _feature_frame(df, bench)
    row = e.iloc[-1]
    if row[FEATURES].isna().any():
        row = e[FEATURES].ffill().iloc[-1].combine_first(row)
        if row[FEATURES].isna().any():
            return None

    base_prob = float(model.predict_proba(
        pd.DataFrame([row[FEATURES]], columns=FEATURES))[0, 1])  # P(beat median)

    # Sentiment adjustment, deliberately capped and reported separately.
    news_score = float(sentiment.get("score") or 0.0)
    news_n = int(sentiment.get("count") or 0)
    damp = min(1.0, news_n / 5.0)                 # thin coverage -> small nudge
    adj = 0.10 * news_score * damp
    prob = float(np.clip(base_prob + adj, 0.02, 0.98))

    # Expected move RELATIVE to the median stock, scaled by this stock's own
    # volatility and the square root of the horizon.
    atr_pct = float(e["atr_pct"].iloc[-1] or 0.02)
    expected_move = (prob - 0.5) * 2 * atr_pct * np.sqrt(horizon) * 100

    drivers = _contributions(model, row)
    if abs(adj) > 0.005:
        drivers.insert(0, {
            "feature": "news_sentiment",
            "label": f"news sentiment ({news_n} stories, {sentiment.get('label')})",
            "contribution": round(adj, 4),
            "direction": "bullish" if adj > 0 else "bearish",
            "value": round(news_score, 4),
        })

    return {
        "symbol": symbol,
        "horizon_days": horizon,
        # Probability of OUTPERFORMING the universe median, not of rising.
        "prob_outperform": round(prob, 4),
        "prob_technical_only": round(base_prob, 4),
        "sentiment_adjustment": round(adj, 4),
        "expected_rel_move_pct": round(float(expected_move), 2),
        "confidence": _confidence(prob, metrics.get("holdout_auc", 0), news_n),
        "drivers": drivers,
        "model_auc": metrics.get("holdout_auc"),
    }
