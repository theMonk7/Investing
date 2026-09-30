"""Offline smoke test: synthetic prices through every pure module."""
import sys, numpy as np, pandas as pd
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent / "pipeline"))

rng = np.random.default_rng(7)
def synth(n=800, drift=0.0004, vol=0.018, start=100.0):
    idx = pd.bdate_range("2021-01-01", periods=n)
    r = rng.normal(drift, vol, n)
    close = start * np.exp(np.cumsum(r))
    high = close * (1 + np.abs(rng.normal(0, 0.006, n)))
    low  = close * (1 - np.abs(rng.normal(0, 0.006, n)))
    op   = np.r_[close[0], close[:-1]] * (1 + rng.normal(0, 0.003, n))
    vol_ = rng.lognormal(13, 0.4, n)
    return pd.DataFrame({"open": op, "high": high, "low": low, "close": close, "volume": vol_}, index=idx)

import technicals, predict, movers, teach, sentiment, fetch_prices, universe

hist = {f"T{i}.NS": synth(drift=rng.normal(0.0003, 0.0004)) for i in range(20)}
bench = synth()["close"]

e = technicals.enrich(hist["T0.NS"])
need = ["rsi14","macd_hist","atr_pct","bb_pctb","vol_z","obv_slope","pct_from_52w_hi"]
assert not e[need].tail(1).isna().any().any(), e[need].tail(1)
print("technicals OK  trend:", technicals.trend_label(e.iloc[-1]),
      " sup/res:", technicals.support_resistance(e))

ds = predict.build_dataset(hist, bench)
print("dataset rows:", len(ds))
model, metrics = predict.train(ds)
print("metrics:", metrics)
assert model is not None

quotes = []
for sym, df in hist.items():
    q = fetch_prices.quote_from(sym, df, {"name": sym})
    q["sector"] = universe.sector_of(sym); q["watched"] = True
    quotes.append(q)
print("quote keys:", len(quotes[0]))

sent = {"score": 0.3, "label": "mildly bullish", "count": 5, "bullish": 3, "bearish": 1, "neutral": 1}
preds = {s: predict.predict_symbol(model, metrics, s, d, bench, sent) for s, d in hist.items()}
preds = {k: v for k, v in preds.items() if v}
print("predictions:", len(preds), "| sample:", {k: preds[k]["prob_outperform"] for k in list(preds)[:3]})
assert preds[list(preds)[0]]["drivers"]

regime = movers.market_regime(synth(), synth(start=15, vol=0.05), quotes)
print("regime:", regime["regime"], "breadth", regime["advancers_pct"])
secs = movers.sector_rotation(quotes, "IN")
cands = movers.candidates(quotes, secs, preds)
print("candidates bull/bear:", len(cands["bullish"]), len(cands["bearish"]))
print("top reasons:", cands["bullish"][0]["reasons"][:2])
tm = movers.top_movers(quotes); print("movers buckets:", {k: len(v) for k, v in tm.items()})

items = [
  {"title": "Company beats estimates, raises guidance", "summary": "", "published": "2026-09-29T10:00:00+00:00", "symbol": "T0.NS"},
  {"title": "Regulator opens probe into accounting fraud", "summary": "", "published": "2026-09-28T10:00:00+00:00", "symbol": "T0.NS"},
  {"title": "Board meeting scheduled", "summary": "", "published": "2026-09-27T10:00:00+00:00", "symbol": "T0.NS"},
]
sentiment.score_items(items, use_llm=False)
print("sentiment:", [(i["title"][:28], i["sentiment"]) for i in items])
print("aggregate:", sentiment.aggregate(items))

q = quotes[0]; q["change_pct"] = 4.2; q["vol_z"] = 3.1; q["rsi14"] = 74.0
evs = teach.detect_events(q, sent, preds.get(q["symbol"]))
print("events:", [x["kind"] for x in evs])
lesson = teach.explain_event(q, evs[0], sent, items, use_llm=False)
print("lesson len:", len(lesson["explanation"]), "|", lesson["explanation"][:130], "...")
brief = teach.daily_brief("IN", regime, secs, tm, sentiment.aggregate(items), use_llm=False)
print("brief:", brief["text"][:150], "...")
print("\nALL OFFLINE CHECKS PASSED")
