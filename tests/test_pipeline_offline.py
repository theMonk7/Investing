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

# --- corporate events: parsers, upsert precedence, export de-duplication ----
import json, sqlite3, tempfile
from datetime import date, timedelta
from pathlib import Path
import corporate_events as ce, store, run_all

assert ce.classify("Quarterly Results and Interim Dividend") == ["results", "dividend"]
assert ce.classify("Fund raising by way of QIP") == ["fundraise"]
assert ce.classify("General business") == []

soon = date.today() + timedelta(days=12)
bm = ce.nse_board_meeting({
    "bm_symbol": "INFY", "sm_name": "Infosys Limited", "bm_date": soon.strftime("%d-%b-%Y"),
    "bm_purpose": "Financial Results",
    "bm_desc": "Infosys Limited has informed the Exchange about Board Meeting to be held on "
               f"{soon.strftime('%d-%b-%Y')} to consider and approve the quarterly results.",
    "attachment": "https://nsearchives.nseindia.com/x.pdf", "sm_indusrty": "IT"})
assert bm["symbol"] == "INFY.NS" and bm["date"] == soon.isoformat(), bm
assert bm["types"] == ["board_meeting", "results"] and bm["official"] and bm["source"] == "NSE"
assert bm["detail"].startswith("Consider and approve"), bm["detail"]
assert ce.nse_board_meeting({"bm_symbol": "", "bm_date": "01-Jan-2026"}) is None

ca = ce.nse_corporate_action({"symbol": "ITC", "comp": "ITC Limited", "series": "EQ",
                              "subject": "Interim Dividend - Rs 6 Per Share",
                              "exDate": soon.strftime("%d-%b-%Y"), "recDate": "-"})
assert ca["types"] == ["dividend"] and ca["detail"].startswith("Ex-date"), ca
assert ce.nse_corporate_action({"symbol": "X", "series": "EQ", "subject": "Interest Payment",
                                "exDate": "01-Jan-2026"}) is None
assert ce.nse_corporate_action({"symbol": "X", "series": "N1", "subject": "Dividend",
                                "exDate": "01-Jan-2026"}) is None

er = ce.nasdaq_earnings_row({"symbol": "aapl", "name": "Apple Inc.", "time": "time-after-hours",
                             "fiscalQuarterEnding": "Sep/2026", "epsForecast": "$1.60",
                             "noOfEsts": "12", "lastYearEPS": "$1.45"}, soon)
assert er["symbol"] == "AAPL" and er["time"] == "after close" and "EPS est $1.60" in er["detail"], er
assert ce._cap("$3,456,789,000") == 3456789000.0

cx = sqlite3.connect(":memory:")
cx.row_factory = sqlite3.Row
cx.executescript(store.SCHEMA)
store._migrate(cx)
est = ce._event("IN", "INFY.NS", "Infosys", soon + timedelta(days=3), ["results"],
                "Results (expected)", kind="yfer", source="Yahoo Finance",
                official=False, estimated=True)
far_est = ce._event("IN", "ITC.NS", "ITC", soon, ["results"], "Results (expected)",
                    kind="yfer", source="Yahoo Finance", official=False, estimated=True)
store.save_corp_events(cx, [bm, est, far_est])
# An estimate re-using an official row's id must not overwrite it.
store.save_corp_events(cx, [{**bm, "official": False, "title": "stale estimate"}])
with tempfile.TemporaryDirectory() as tmp:
    payload = ce.export(cx, "IN", Path(tmp) / "IN" / "events.json")
    on_disk = json.loads((Path(tmp) / "IN" / "events.json").read_text())
ids = {e["id"] for e in payload["items"]}
assert bm["id"] in ids and far_est["id"] in ids, ids
assert est["id"] not in ids, "estimate within 10 days of an official results meeting should drop"
assert next(e for e in payload["items"] if e["id"] == bm["id"])["title"] == bm["title"]
assert on_disk["window"]["from"] <= soon.isoformat() <= on_disk["window"]["to"]
assert all("market" not in e and "first_seen" not in e for e in on_disk["items"])
print("corporate events OK:", len(payload["items"]), "items exported")

parsed = run_all.parse_symbols("infy.ns, AAPL  aapl;rm -rf / TCS.BO $(x) msft")
assert parsed["IN"] == ["INFY.NS", "TCS.BO"] and parsed["US"] == ["AAPL", "MSFT"], parsed
print("parse_symbols OK:", parsed)

# --- fundamentals: statements, surprises, reactions, refresh ---------------
import fundamentals as fu

cols = pd.to_datetime(["2026-06-30", "2026-03-31", "2025-12-31", "2025-09-30", "2025-06-30", "2025-03-31"])
stmt = pd.DataFrame([[120.0, 110, 105, 100, 100, 105],
                     [24.0, 20, 19, 18, 18, 19],
                     [12.0, 11, 10, 9, 8, 10],
                     [1.2, 1.1, 1.0, 0.9, 0.8, 1.0]],
                    index=["Total Revenue", "Operating Income", "Net Income", "Diluted EPS"], columns=cols)
qs = fu.quarters_from(stmt)
periods = [x["period"] for x in qs]
# 2025-12-31 and 2025-03-31 are identical copies (a real Yahoo glitch): both dropped.
assert periods == ["2026-06-30", "2026-03-31", "2025-09-30", "2025-06-30"], periods
assert qs[0]["op_margin"] == 20.0
s = fu.summarise(qs)
assert s["rev_yoy"] == 20.0 and s["ni_yoy"] == 50.0 and s["margin_chg_yoy"] == 2.0, s
assert s["rev_qoq"] == 9.1, s

px = pd.DataFrame({"close": [100.0, 101, 102, 110, 111, 112, 113, 114, 115]},
                  index=pd.bdate_range("2026-01-05", periods=9))   # Mon 5 .. Thu 15 Jan
day = date(2026, 1, 7)                                             # close 102
assert fu.reaction(px, day, True)["move_pct"] == round((110 / 102 - 1) * 100, 2)    # next day's close
assert fu.reaction(px, day, False)["move_pct"] == round((102 / 101 - 1) * 100, 2)   # same-day close
r_unknown = fu.reaction(px, day, None)
assert r_unknown["move_pct"] == round((110 / 101 - 1) * 100, 2), r_unknown         # spans the day
assert r_unknown["drift_5d_pct"] == round((114 / 101 - 1) * 100, 2), r_unknown
assert fu.reaction(px, date(2026, 3, 1), True) == {}

ed = pd.DataFrame({"EPS Estimate": [1.30, 1.00, 1.00], "Reported EPS": [np.nan, 1.10, 0.95],
                   "Surprise(%)": [np.nan, 10.0, -5.0]},
                  index=pd.DatetimeIndex(["2099-01-20 16:30", "2026-01-07 16:30", "2025-10-08 09:00"],
                                         tz="America/New_York"))
hist_rows, upcoming = fu.surprises_from(ed, "US", px, past_dates=["2026-01-08", "2025-07-09"])
assert upcoming == {"date": "2099-01-20", "eps_estimate": 1.3}, upcoming
assert [x["date"] for x in hist_rows] == ["2026-01-07", "2025-10-08", "2025-07-09"], hist_rows
assert hist_rows[0]["surprise_pct"] == 10.0 and hist_rows[0]["move_pct"] == round((110 / 102 - 1) * 100, 2)
stats = fu.reaction_stats(hist_rows)
assert stats["n"] == 1 and stats["beats"] == 1 and stats["misses"] == 1 and stats["rated"] == 2, stats
json.dumps(stats, allow_nan=False)    # numpy scalars would raise here
assert fu.analysts_from({"targetMeanPrice": 110, "numberOfAnalystOpinions": 5,
                         "recommendationKey": "buy"}, 100)["upside_pct"] == 10.0

cx2 = sqlite3.connect(":memory:"); cx2.row_factory = sqlite3.Row
cx2.executescript(store.SCHEMA); store._migrate(cx2)
calls = []
fu.collect = lambda sym, market, df, past=(): calls.append(sym) or {"symbol": sym, "fetched_at": fu.utc_now()}
fu.time.sleep = lambda _s: None
got = fu.refresh(cx2, "US", {"AAPL": px, "MSFT": px}, {"AAPL"})
assert calls == ["AAPL"] and set(got) == {"AAPL"}, (calls, got)
fu.refresh(cx2, "US", {"AAPL": px, "MSFT": px}, {"AAPL"}, force=["MSFT", "AAPL"])
assert calls == ["AAPL", "MSFT"], calls          # fresh entries are not re-fetched
json.dumps(fu.payload("US", got))
print("fundamentals OK:", len(qs), "quarters,", stats)
print("\nALL OFFLINE CHECKS PASSED")
