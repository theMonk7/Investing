"""Pipeline orchestrator.

Run modes (chosen by the GitHub Actions schedule that invokes it):
  --mode quotes  : prices + technicals + alerts        (frequent, cheap)
  --mode news    : quotes + news + sentiment + teaching
  --mode full    : everything, retrains the model      (daily)

Everything is written to data/ as JSON. The static dashboard reads only those
files, so the site works with no backend at all.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

import alerts as alerts_mod
import config
import disclosures
import events as events_mod
import fetch_news
import fetch_prices
import llm
import movers as movers_mod
import predict as predict_mod
import reactions
import scorecard
import sentiment as sentiment_mod
import teach
from config import DATA_DIR, NEWS_WINDOW_DAYS, PREDICT_HORIZON_DAYS
from store import (conn, get_meta, log_events, prune, recent_news, save_news,
                   save_prediction, save_quote, save_sector_daily, sector_history,
                   set_meta, upsert_prices)
from universe import BENCHMARK, CURRENCY, VIX, load_watchlist, sector_of, universe_for

MARKETS = ("IN", "US")


def write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, separators=(",", ":"), default=str))
    tmp.replace(path)


def quote_asof(df) -> str:
    return df.index[-1].strftime("%Y-%m-%d")


def run_market(cx, market: str, mode: str, model, metrics: dict) -> dict:
    t0 = time.time()
    watchlist = load_watchlist()
    watched = set(watchlist.get(market, []))
    symbols = universe_for(market)
    print(f"[{market}] {len(symbols)} symbols, mode={mode}")

    # ---- prices ----------------------------------------------------------
    histories = fetch_prices.download_history(symbols)
    bench_df = fetch_prices.history(BENCHMARK[market], period="2y")
    vix_df = fetch_prices.history(VIX[market], period="6mo")
    bench_close = bench_df["close"] if not bench_df.empty else None
    if not histories:
        return {"market": market, "error": "no price data returned"}

    names = get_meta(cx, f"names:{market}", {})
    missing = [s for s in symbols if s not in names]
    if missing and mode == "full":
        names.update(fetch_prices.fetch_names(missing[:60]))
        set_meta(cx, f"names:{market}", names)

    quotes = []
    for sym, df in histories.items():
        q = fetch_prices.quote_from(sym, df, {"name": names.get(sym, sym)})
        if not q:
            continue
        q["sector"] = sector_of(sym)
        q["watched"] = sym in watched
        quotes.append(q)
        save_quote(cx, sym, market, q)
        upsert_prices(cx, sym, [
            (d.strftime("%Y-%m-%d"), float(r.open), float(r.high),
             float(r.low), float(r.close), float(r.volume))
            for d, r in df.tail(60).iterrows()
        ])
    quotes.sort(key=lambda q: -abs(q["change_pct"]))

    # ---- news + sentiment -------------------------------------------------
    sentiments: dict[str, dict] = {}
    news_by_symbol: dict[str, list[dict]] = {}
    market_news: list[dict] = []
    market_sent = {"score": 0.0, "label": "neutral", "count": 0,
                   "bullish": 0, "bearish": 0, "neutral": 0}

    matcher = events_mod.build_matcher(symbols, names)
    sector_news: dict[str, list[dict]] = {}
    disclosure_items: list[dict] = []

    if mode in ("news", "full"):
        market_news = fetch_news.market_news(market, days=NEWS_WINDOW_DAYS)
        sentiment_mod.score_items(market_news, use_llm=True, llm_budget=25)
        events_mod.enrich(market_news, matcher, market, use_llm=(mode == "full"))
        market_sent = sentiment_mod.aggregate(market_news)
        save_news(cx, market_news)

        # One query per sector, so sector-moving stories that never name a
        # tracked ticker still land somewhere.
        sector_news = fetch_news.sector_news(market, days=NEWS_WINDOW_DAYS)
        for sector, items in sector_news.items():
            if not items:
                continue
            sentiment_mod.score_items(items, use_llm=False)
            events_mod.enrich(items, matcher, market, use_llm=False)
            for it in items:
                it["sector"] = sector      # the query is the attribution
            save_news(cx, items)

        # Officially disclosed filings and transactions.
        disclosure_items = disclosures.fetch(market, days=min(NEWS_WINDOW_DAYS, 5))
        if disclosure_items:
            sentiment_mod.score_items(disclosure_items, use_llm=False)
            events_mod.enrich(disclosure_items, matcher, market, use_llm=False)
            for it in disclosure_items:
                it.setdefault("kind", "disclosure")
            save_news(cx, disclosure_items)

        # Per-ticker news only for the watchlist -- one HTTP call per symbol.
        for sym in sorted(watched):
            items = fetch_news.symbol_news(sym, market, names.get(sym, ""),
                                           days=NEWS_WINDOW_DAYS)
            if not items:
                continue
            sentiment_mod.score_items(items, use_llm=True, llm_budget=10)
            events_mod.enrich(items, matcher, market, use_llm=False)
            save_news(cx, items)
            news_by_symbol[sym] = items
            sentiments[sym] = sentiment_mod.aggregate(items)
            time.sleep(0.4)

        # Log every classified event so reactions.py can grade it later.
        all_items = (market_news + disclosure_items
                     + [i for v in sector_news.values() for i in v]
                     + [i for v in news_by_symbol.values() for i in v])
        logged = reactions.log_from_news(cx, all_items, market)
        print(f"[{market}] logged {logged} classified events")
    else:
        sentiments = get_meta(cx, f"sentiments:{market}", {})
        market_sent = get_meta(cx, f"market_sent:{market}", market_sent)
        news_by_symbol = get_meta(cx, f"news_cache:{market}", {})
        market_news = get_meta(cx, f"market_news:{market}", [])

    set_meta(cx, f"sentiments:{market}", sentiments)
    set_meta(cx, f"market_sent:{market}", market_sent)
    set_meta(cx, f"news_cache:{market}", {k: v[:12] for k, v in news_by_symbol.items()})
    set_meta(cx, f"market_news:{market}", market_news[:60])

    # ---- predictions ------------------------------------------------------
    predictions: dict[str, dict] = {}
    for sym, df in histories.items():
        pred = predict_mod.predict_symbol(
            model, metrics, sym, df, bench_close,
            sentiments.get(sym, {"score": 0, "count": 0, "label": "neutral"}),
        )
        if not pred:
            continue
        predictions[sym] = pred
        # Persisted so scorecard.py can grade it once the horizon elapses.
        save_prediction(cx, sym, quote_asof(df), pred["horizon_days"],
                        pred["prob_outperform"], pred["expected_rel_move_pct"],
                        pred["confidence"], pred["drivers"][:3])

    # ---- regime, sectors, candidates -------------------------------------
    regime = movers_mod.market_regime(bench_df, vix_df, quotes)
    sectors = movers_mod.sector_rotation(quotes, market)
    cands = movers_mod.candidates(quotes, sectors, predictions)
    movers = movers_mod.top_movers(quotes)

    # ---- teaching ---------------------------------------------------------
    lessons = []
    if mode in ("news", "full"):
        for q in quotes:
            if not q["watched"] and abs(q["change_pct"]) < 4:
                continue
            sent = sentiments.get(q["symbol"],
                                  {"score": 0, "count": 0, "label": "neutral",
                                   "bullish": 0, "bearish": 0})
            for event in teach.detect_events(q, sent, predictions.get(q["symbol"])):
                if event["severity"] == "low" and len(lessons) > 12:
                    continue
                lessons.append(teach.explain_event(
                    q, event, sent, news_by_symbol.get(q["symbol"], []),
                    use_llm=len(lessons) < 8,   # cap free-tier LLM spend
                ))
        set_meta(cx, f"lessons:{market}", lessons[:30])
    else:
        lessons = get_meta(cx, f"lessons:{market}", [])

    brief = teach.daily_brief(market, regime, sectors, movers, market_sent,
                              use_llm=(mode == "full"))

    # ---- alerts -----------------------------------------------------------
    pending = alerts_mod.build_alerts(cx, market, quotes, sentiments,
                                      predictions, watched)
    delivery = alerts_mod.dispatch(cx, pending)

    # ---- charts -----------------------------------------------------------
    chart_dir = DATA_DIR / market / "charts"
    keep = set()
    for sym in watched:
        if sym in histories:
            name = f"{sym.replace('/', '_')}.json"
            keep.add(name)
            write_json(chart_dir / name, fetch_prices.ohlc_series(histories[sym]))
    # Drop charts for symbols the user has since unwatched.
    if chart_dir.exists():
        for stale in chart_dir.glob("*.json"):
            if stale.name not in keep:
                stale.unlink()

    # The accumulating feed is read back from SQLite, so it holds everything
    # we have ever seen for this market -- not just what this run fetched.
    feed = recent_news(cx, market, limit=400)

    # --- sector rollup, persisted so the charts have real history ---------
    quotes_by_symbol = {q["symbol"]: q for q in quotes}
    today = datetime.now(timezone.utc).date().isoformat()
    sector_rows = []
    sector_story_index: dict[str, list[dict]] = {}
    for sec in sectors:
        name = sec["sector"]
        # Draw from the accumulated store first so a thin fetch on one run
        # does not empty a sector's panel; top up with this run's results.
        stories = [n for n in feed if n.get("sector") == name]
        seen_ids = {n["id"] for n in stories}
        stories += [n for n in sector_news.get(name, []) + market_news
                    if n.get("sector") == name and n["id"] not in seen_ids]
        stories = sorted(stories, key=lambda x: x["published"], reverse=True)[:25]
        sector_story_index[name] = stories
        agg = sentiment_mod.aggregate(stories)
        sector_rows.append({
            "sector": name, "date": today,
            "sentiment": agg["score"], "story_count": agg["count"],
            "bullish": agg["bullish"], "bearish": agg["bearish"],
            "neutral": agg["neutral"],
            "ret_1d": sec["ret_1d"], "ret_5d": sec["ret_5d"],
        })
        sec["sentiment"] = agg["score"]
        sec["sentiment_label"] = agg["label"]
        sec["story_count"] = agg["count"]
        sec["bullish"] = agg["bullish"]
        sec["bearish"] = agg["bearish"]
    if sector_rows:
        save_sector_daily(cx, market, sector_rows)
    sector_series = sector_history(cx, market, days=45)

    reactions.grade_pending(cx)
    event_stats = reactions.summarise(cx, market)
    catalyst_rows = reactions.catalysts(cx, market, quotes_by_symbol)

    # Newest-first by when WE first saw it, so a refresh adds rather than replaces.
    write_json(DATA_DIR / market / "feed.json", {
        "market": market,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "count": len(feed),
        "items": feed,
    })

    recent_alerts = [dict(r) for r in cx.execute(
        "SELECT ts,symbol,kind,severity,title,body FROM alerts "
        "WHERE market=? ORDER BY id DESC LIMIT 60", (market,)).fetchall()]

    bundle = {
        "market": market,
        "currency": CURRENCY[market],
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "regime": regime,
        "brief": brief,
        "quotes": quotes,
        "watchlist": sorted(watched),
        "sectors": sectors,
        "movers": movers,
        "candidates": cands,
        "predictions": predictions,
        "market_sentiment": market_sent,
        "market_news": market_news[:40],
        "news_by_symbol": {k: v[:8] for k, v in news_by_symbol.items()},
        "sector_news": {k: v[:12] for k, v in sector_story_index.items()},
        "sector_series": sector_series,
        "disclosures": sorted(
            [n for n in feed if n.get("kind") in ("filing", "disclosure")],
            key=lambda x: x.get("first_seen") or "", reverse=True)[:80],
        "catalysts": catalyst_rows,
        "event_stats": event_stats,
        "event_status": reactions.status(cx),
        "feed_count": len(feed),
        "lessons": lessons[:24],
        "alerts": recent_alerts,
        "charts_available": sorted(watched & set(histories)),
    }
    write_json(DATA_DIR / market / "bundle.json", bundle)

    elapsed = round(time.time() - t0, 1)
    print(f"[{market}] done in {elapsed}s — {len(quotes)} quotes, "
          f"{len(market_news)} market stories, {len(lessons)} lessons, "
          f"{delivery['sent']} alerts via {delivery['channels'] or 'none'}")
    return {"market": market, "quotes": len(quotes), "alerts": delivery,
            "elapsed_s": elapsed}


def train_model(cx):
    """Trained on the Indian universe and reused for both markets.

    Cross-sectional technical patterns transfer; keeping one model avoids
    two training passes inside the Actions time budget. The holdout metric
    published to the UI is from this fit.
    """
    print("[model] training...")
    symbols = universe_for("IN")[:45] + universe_for("US")[:25]
    histories = fetch_prices.download_history(symbols, period="5y")
    bench = fetch_prices.history(BENCHMARK["IN"], period="5y")
    bench_close = bench["close"] if not bench.empty else None

    dataset = predict_mod.build_dataset(histories, bench_close,
                                        horizon=PREDICT_HORIZON_DAYS)
    model, metrics = predict_mod.train(dataset)
    print(f"[model] {metrics}")
    if model is not None:
        import pickle
        (DATA_DIR / "model.pkl").write_bytes(pickle.dumps(model))
        set_meta(cx, "model_metrics", metrics)
    return model, metrics


def load_model(cx):
    import pickle
    path = DATA_DIR / "model.pkl"
    if not path.exists():
        return None, {}
    try:
        return pickle.loads(path.read_bytes()), get_meta(cx, "model_metrics", {})
    except Exception as exc:  # noqa: BLE001
        print(f"[model] load failed, will retrain: {exc}")
        return None, {}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=("quotes", "news", "full"), default="full")
    ap.add_argument("--markets", default="IN,US")
    args = ap.parse_args()

    targets = [m for m in args.markets.split(",") if m in MARKETS]
    results, failures = [], []

    with conn() as cx:
        model, metrics = load_model(cx)
        if args.mode == "full" or model is None:
            try:
                model, metrics = train_model(cx)
            except Exception:  # noqa: BLE001
                traceback.print_exc()
                print("[model] training failed; continuing without predictions")

        for market in targets:
            try:
                results.append(run_market(cx, market, args.mode, model, metrics))
            except Exception:  # noqa: BLE001 - one market must not kill the other
                traceback.print_exc()
                failures.append(market)

        prune(cx)
        set_meta(cx, "last_run", datetime.now(timezone.utc).isoformat(timespec="seconds"))

    try:
        card = scorecard.grade()
    except Exception:  # noqa: BLE001 - grading must never fail a data run
        traceback.print_exc()
        card = {"status": "grading failed", "n": 0}
    write_json(DATA_DIR / "scorecard.json", card)
    print(f"[scorecard] {card.get('n', 0)} graded, hit rate {card.get('hit_rate')}")

    write_json(DATA_DIR / "curriculum.json", teach.CURRICULUM)
    write_json(DATA_DIR / "meta.json", {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "mode": args.mode,
        "markets": targets,
        "failed_markets": failures,
        "model_metrics": metrics,
        "scorecard": {k: v for k, v in card.items() if k != "recent"},
        "llm_provider": llm.provider_name(),
        "sec_filings_enabled": bool(config.SEC_CONTACT_EMAIL),
        "news_window_days": NEWS_WINDOW_DAYS,
        "predict_horizon_days": PREDICT_HORIZON_DAYS,
        "alert_thresholds": {
            "pct_move": config.ALERT_PCT_MOVE,
            "volume_z": config.ALERT_VOLUME_Z,
            "rsi_high": config.ALERT_RSI_HIGH,
            "rsi_low": config.ALERT_RSI_LOW,
            "cooldown_hours": config.ALERT_COOLDOWN_HOURS,
        },
        "results": results,
        "disclaimer": (
            "Educational tool. Not investment advice. Data from public free "
            "sources and may be delayed or wrong. Model probabilities carry a "
            "measured, small edge at best -- see holdout AUC. Every filing and "
            "disclosure shown is public information published by a regulator or "
            "an exchange; nothing here is or seeks material non-public "
            "information, which it is illegal to trade on."
        ),
    })
    print(f"[done] failures={failures or 'none'}")
    return 1 if failures == targets else 0


if __name__ == "__main__":
    sys.exit(main())
