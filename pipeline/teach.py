"""Teaching engine.

Detects what actually happened today, then explains *that*, rather than
showing generic encyclopedia entries. Templates are the floor; an LLM, when
configured, rewrites them with the day's specific numbers and news.
"""
from __future__ import annotations

from datetime import datetime, timezone

import llm
from universe import sector_of

# ---------------------------------------------------------------------------
# Static curriculum. Always available, LLM or not.
# ---------------------------------------------------------------------------
CURRICULUM = [
    {
        "id": "rsi", "title": "RSI: what 'overbought' really means", "level": "beginner",
        "tags": ["momentum", "indicator"],
        "body": (
            "RSI(14) compares average gains to average losses over 14 sessions and "
            "maps it to 0-100. Above 70 is conventionally 'overbought', below 30 "
            "'oversold'.\n\n"
            "The common mistake: treating RSI > 70 as a sell signal. In a strong "
            "trend RSI can sit above 70 for weeks — that is what strength looks "
            "like. RSI is most useful as a *divergence* tool: price makes a new "
            "high, RSI makes a lower high, and the move is running out of fuel.\n\n"
            "Use it with trend context. RSI 75 in a stock above its rising 200-DMA "
            "means momentum. RSI 75 in a downtrending stock usually means a "
            "bear-market rally."
        ),
    },
    {
        "id": "volume", "title": "Why volume confirms (or kills) a move", "level": "beginner",
        "tags": ["volume", "confirmation"],
        "body": (
            "Price tells you what happened. Volume tells you how many people "
            "agreed.\n\n"
            "A 4% rally on 3x average volume means real institutional buying — "
            "size had to be absorbed. The same 4% on half-average volume means a "
            "thin book moved easily and can just as easily reverse.\n\n"
            "This dashboard reports volume as a z-score vs the 20-day average, so "
            "+2.5 means 'today's volume is 2.5 standard deviations above normal'. "
            "Anything past +2 is worth a look. Breakouts without volume fail "
            "disproportionately often."
        ),
    },
    {
        "id": "movingavg", "title": "Moving averages: 50-DMA and 200-DMA", "level": "beginner",
        "tags": ["trend"],
        "body": (
            "The 50-day moving average is the medium-term trend; the 200-day is "
            "the long-term one. Their relationship is the cheapest regime filter "
            "that exists.\n\n"
            "Price > 50-DMA > 200-DMA = uptrend, buy dips. Price < 50-DMA < "
            "200-DMA = downtrend, rallies get sold. 50 crossing above 200 is a "
            "'golden cross'; below is a 'death cross'. Both are *lagging* — they "
            "confirm a trend that already started, they do not predict one.\n\n"
            "Their real value is as a stop-thinking filter: do not buy breakouts "
            "in stocks below their 200-DMA."
        ),
    },
    {
        "id": "gap", "title": "Gap ups and gap downs", "level": "intermediate",
        "tags": ["price-action", "event"],
        "body": (
            "A gap is when today's open is away from yesterday's close — news "
            "arrived while the market was shut.\n\n"
            "Three kinds matter. A *breakaway gap* starts a new trend out of a "
            "range, usually on heavy volume, and tends to hold. A *continuation "
            "gap* appears mid-trend and confirms it. An *exhaustion gap* comes "
            "after an extended run and marks the end.\n\n"
            "The tell is what happens after the first hour. If a gap up holds "
            "above the opening price all day, buyers are in control. If it fills "
            "(price returns to yesterday's close), the news was already priced in."
        ),
    },
    {
        "id": "sentiment", "title": "How news sentiment is scored here", "level": "intermediate",
        "tags": ["news", "nlp"],
        "body": (
            "Headlines are scored -1 to +1. The base scorer is VADER with a "
            "finance lexicon layered on, because general-purpose sentiment models "
            "read 'beat', 'miss', 'downgrade' and 'cut' as neutral words.\n\n"
            "Scores are aggregated with a 3-day half-life, so a headline from "
            "today counts roughly twice as much as one from three days ago.\n\n"
            "Two cautions. Sentiment measures *coverage tone*, not truth — a stock "
            "can rally on bad news if the news was less bad than feared. And "
            "headline sentiment is largely already in the price by the time you "
            "read it. Treat it as context, not a signal."
        ),
    },
    {
        "id": "atr", "title": "ATR: sizing positions by volatility", "level": "intermediate",
        "tags": ["risk", "volatility"],
        "body": (
            "Average True Range measures how far a stock typically travels in a "
            "day, including gaps. Shown here as a percentage of price.\n\n"
            "Its main use is position sizing. If you risk 1% of capital per trade "
            "and the stock's ATR is 3%, a stop placed 1.5 ATR away is 4.5% — so "
            "your position can be at most ~22% of capital. A 1% ATR stock lets you "
            "take a much bigger position for the same risk.\n\n"
            "Sizing every position the same rupee amount, regardless of "
            "volatility, is one of the most common ways retail accounts blow up."
        ),
    },
    {
        "id": "breadth", "title": "Market breadth: is the rally real?", "level": "intermediate",
        "tags": ["market", "regime"],
        "body": (
            "Breadth is how many stocks participate. An index can rise while most "
            "of its constituents fall, if the few largest weights are up.\n\n"
            "Two measures here: percent of tracked stocks advancing today, and "
            "percent trading above their own 50-DMA. Above 60% on the second is a "
            "healthy, broad trend. Below 35% while the index is near highs is a "
            "narrow rally — historically fragile.\n\n"
            "Breadth deteriorating while the index makes new highs is one of the "
            "few genuinely useful leading warnings."
        ),
    },
    {
        "id": "probability", "title": "Reading this dashboard's probability honestly", "level": "advanced",
        "tags": ["model", "statistics"],
        "body": (
            "The percentage on the Model tab is the probability a stock "
            "OUTPERFORMS the median stock in the universe over the horizon. It is "
            "relative strength, not direction.\n\n"
            "That distinction is the whole design. An absolute 'will it go up' "
            "target was tried first and scored AUC 0.49 on holdout -- worse than a "
            "coin flip -- because most of a stock's short-term return is the "
            "market's return, and no technical indicator predicts that. Removing "
            "the cross-sectional median strips the market factor out and leaves "
            "the part these features can actually speak to.\n\n"
            "So 60% does not mean the stock rises. In a falling market the "
            "top-ranked stock usually still falls, just less than its peers. If "
            "you want a view on market direction, look at the regime and breadth "
            "on the Overview tab, not at this number.\n\n"
            "AUC 0.50 is a coin flip; realistic cross-sectional equity models land "
            "at 0.52-0.56, and so does this one. That edge is real but small, "
            "shows up only across many independent positions, and is erased by "
            "overtrading. The Live scorecard grades every matured prediction "
            "against what actually happened -- trust that over the training "
            "metric."
        ),
    },
    {
        "id": "sectorrotation", "title": "Sector rotation", "level": "advanced",
        "tags": ["macro", "sectors"],
        "body": (
            "Money moves between sectors in fairly persistent cycles. Early "
            "recovery favours financials and cyclicals; late cycle favours energy "
            "and materials; contraction favours staples, utilities and pharma.\n\n"
            "The Sectors view ranks equal-weighted sector returns over 1, 5 and 20 "
            "days. What matters is the *change* in ranking, not the level. A "
            "sector moving from bottom quartile to top over two weeks, on rising "
            "volume, is rotation in progress.\n\n"
            "Individual stocks inherit most of their return from their sector. "
            "Picking the right sector and an average stock usually beats picking "
            "the best stock in the wrong sector."
        ),
    },
    {
        "id": "risk", "title": "Position sizing and stop losses", "level": "beginner",
        "tags": ["risk"],
        "body": (
            "Decide the exit before the entry. Two rules survive contact with "
            "reality:\n\n"
            "1. Risk a fixed small percentage of capital per position — 1% is a "
            "common choice. Position size = (capital x 1%) / (entry - stop).\n"
            "2. Place the stop where your thesis is wrong, not where your pain "
            "threshold is. Below the recent swing low, or 1.5-2 ATR away.\n\n"
            "Averaging down on a losing position without a pre-planned level is "
            "how a small loss becomes an unrecoverable one."
        ),
    },
]

# ---------------------------------------------------------------------------
# Event detection -> contextual lessons
# ---------------------------------------------------------------------------


def detect_events(quote: dict, sentiment: dict, prediction: dict | None) -> list[dict]:
    """Return the notable things that happened to this stock today."""
    events = []
    sym, chg = quote["symbol"], quote["change_pct"]

    if abs(chg) >= 3:
        events.append({
            "kind": "big_move", "severity": "high",
            "headline": f"{sym} moved {chg:+.2f}% today",
            "facts": {
                "change_pct": chg, "volume_z": quote["vol_z"],
                "rsi": quote["rsi14"], "atr_pct": quote["atr_pct"],
            },
            "lesson_ids": ["volume", "atr"],
        })
    if quote["vol_z"] >= 2.5:
        events.append({
            "kind": "volume_spike", "severity": "medium",
            "headline": f"{sym} traded on unusually heavy volume "
                        f"({quote['vol_z']:.1f} SD above its 20-day average)",
            "facts": {"volume_z": quote["vol_z"], "change_pct": chg},
            "lesson_ids": ["volume"],
        })
    if abs(quote["gap_pct"]) >= 1.5:
        events.append({
            "kind": "gap", "severity": "medium",
            "headline": f"{sym} gapped {quote['gap_pct']:+.2f}% at the open",
            "facts": {"gap_pct": quote["gap_pct"], "change_pct": chg},
            "lesson_ids": ["gap"],
        })
    if quote["rsi14"] >= 72:
        events.append({
            "kind": "overbought", "severity": "low",
            "headline": f"{sym} RSI is {quote['rsi14']:.0f} — technically overbought",
            "facts": {"rsi": quote["rsi14"], "ret_20d": quote["ret_20d"]},
            "lesson_ids": ["rsi"],
        })
    elif quote["rsi14"] <= 28:
        events.append({
            "kind": "oversold", "severity": "low",
            "headline": f"{sym} RSI is {quote['rsi14']:.0f} — technically oversold",
            "facts": {"rsi": quote["rsi14"], "ret_20d": quote["ret_20d"]},
            "lesson_ids": ["rsi"],
        })
    if quote["pct_from_52w_hi"] > -1:
        events.append({
            "kind": "52w_high", "severity": "medium",
            "headline": f"{sym} is at or near its 52-week high",
            "facts": {"hi_52w": quote["hi_52w"], "close": quote["close"]},
            "lesson_ids": ["movingavg", "volume"],
        })
    if quote["close"] > quote["sma50"] > quote["sma200"] and quote["ret_20d"] > 5:
        events.append({
            "kind": "trend_strong", "severity": "low",
            "headline": f"{sym} is in a confirmed uptrend, up {quote['ret_20d']:.1f}% in a month",
            "facts": {"ret_20d": quote["ret_20d"]},
            "lesson_ids": ["movingavg"],
        })
    if abs(sentiment.get("score", 0)) >= 0.4 and sentiment.get("count", 0) >= 3:
        events.append({
            "kind": "news_cluster", "severity": "medium",
            "headline": f"{sym} news flow is strongly {sentiment['label']} "
                        f"({sentiment['count']} stories)",
            "facts": sentiment,
            "lesson_ids": ["sentiment"],
        })
    return events


def _template_explanation(quote: dict, event: dict, sentiment: dict,
                          headlines: list[dict]) -> str:
    sym, chg = quote["symbol"], quote["change_pct"]
    vol_z, rsi = quote["vol_z"], quote["rsi14"]
    parts = [event["headline"] + "."]

    if event["kind"] in ("big_move", "gap", "volume_spike"):
        if vol_z >= 2:
            parts.append(
                f"Volume was {vol_z:.1f} standard deviations above its 20-day "
                f"average, so this was a conviction move, not thin-book drift. "
                f"Moves backed by volume tend to follow through; moves without it "
                f"tend to fade."
            )
        else:
            parts.append(
                f"Volume was only {vol_z:+.1f} SD from normal. A move this size on "
                f"ordinary volume usually means few participants actually changed "
                f"their mind — treat it as less durable."
            )

    if headlines:
        top = headlines[0]
        parts.append(
            f"The most likely trigger in the news window: \"{top.get('title', '')}\" "
            f"({top.get('source', 'unknown source')}, "
            f"sentiment {float(top.get('sentiment') or 0):+.2f})."
        )
        if sentiment.get("count", 0) > 1:
            parts.append(
                f"Across {sentiment['count']} stories the aggregate tone is "
                f"{sentiment['label']} ({sentiment['score']:+.2f}), with "
                f"{sentiment['bullish']} positive and {sentiment['bearish']} negative."
            )
    else:
        parts.append(
            "No matching news was found in the window, which points to a "
            "technical or sector-driven move rather than a company-specific one."
        )

    trend = ("above both its 50-DMA and 200-DMA" if quote["close"] > quote["sma50"] > quote["sma200"]
             else "below both its 50-DMA and 200-DMA" if quote["close"] < quote["sma50"] < quote["sma200"]
             else "between its 50-DMA and 200-DMA")
    parts.append(
        f"Context: {sym} trades {trend}, RSI {rsi:.0f}, ATR {quote['atr_pct']:.1f}% "
        f"of price, {quote['pct_from_52w_hi']:+.1f}% from its 52-week high. "
        f"Sector: {sector_of(sym)}."
    )
    parts.append(
        f"What to watch next: whether the move holds above today's "
        f"{'high' if chg > 0 else 'low'}, and whether volume stays elevated "
        f"tomorrow. One day of anything is noise."
    )
    return " ".join(parts)


def explain_event(quote: dict, event: dict, sentiment: dict,
                  headlines: list[dict], use_llm: bool = True) -> dict:
    """Template first, LLM enrichment second. Template is the guaranteed floor."""
    base = _template_explanation(quote, event, sentiment, headlines)
    enriched, source = base, "template"

    if use_llm and llm.available() and event["severity"] in ("high", "medium"):
        facts = {
            "symbol": quote["symbol"], "change_pct": quote["change_pct"],
            "volume_z": quote["vol_z"], "rsi": quote["rsi14"],
            "atr_pct": quote["atr_pct"], "close": quote["close"],
            "sma50": quote["sma50"], "sma200": quote["sma200"],
            "ret_20d": quote["ret_20d"],
            "pct_from_52w_high": quote["pct_from_52w_hi"],
            "sector": sector_of(quote["symbol"]),
            "news_sentiment": sentiment,
            "headlines": [h["title"] for h in headlines[:5]],
        }
        out = llm.complete(
            "Explain to a retail investor learning markets why this happened and "
            "what it teaches. Use ONLY the facts given -- never invent a number, "
            "a headline or a cause. If the cause is unclear, say so plainly.\n"
            "Three short paragraphs: (1) what happened and the most likely reason, "
            "(2) the general market concept this illustrates, (3) what to watch "
            "next and what would invalidate the read. No advice to buy or sell.\n\n"
            f"FACTS: {facts}",
            system=("You are a patient markets teacher. Precise, plain English, no "
                    "hype, no price targets, no recommendations. Never fabricate."),
            max_tokens=520,
        )
        if out and len(out) > 120:
            enriched, source = out, f"llm:{llm.provider_name()}"

    return {
        "id": f"{quote['symbol']}:{event['kind']}:{datetime.now(timezone.utc):%Y%m%d}",
        "symbol": quote["symbol"],
        "kind": event["kind"],
        "severity": event["severity"],
        "headline": event["headline"],
        "explanation": enriched,
        "source": source,
        "related_lessons": event["lesson_ids"],
        "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def daily_brief(market: str, regime: dict, sectors: list[dict],
                movers: dict, market_sentiment: dict,
                use_llm: bool = True) -> dict:
    """One-paragraph 'what happened today' summary for the top of the page."""
    top_sec = sectors[0] if sectors else None
    bot_sec = sectors[-1] if sectors else None
    gainer = movers["gainers"][0] if movers.get("gainers") else None
    loser = movers["losers"][0] if movers.get("losers") else None

    lines = [
        f"{'Indian' if market == 'IN' else 'US'} market regime: {regime.get('regime')}. "
        f"The index closed {regime.get('index_change_pct', 0):+.2f}% with "
        f"{regime.get('advancers_pct', 0):.0f}% of tracked stocks advancing and "
        f"{regime.get('pct_above_sma50', 0):.0f}% above their 50-day average."
    ]
    if regime.get("vix") is not None:
        lines.append(f"Volatility index at {regime['vix']} "
                     f"({regime.get('vix_change_pct', 0):+.1f}%).")
    if top_sec and bot_sec:
        lines.append(f"{top_sec['sector']} led over five days ({top_sec['ret_5d']:+.1f}%); "
                     f"{bot_sec['sector']} lagged ({bot_sec['ret_5d']:+.1f}%).")
    if gainer and loser:
        lines.append(f"Biggest movers: {gainer['symbol']} {gainer['change_pct']:+.2f}%, "
                     f"{loser['symbol']} {loser['change_pct']:+.2f}%.")
    lines.append(f"News tone across {market_sentiment.get('count', 0)} stories in the "
                 f"window is {market_sentiment.get('label', 'neutral')} "
                 f"({market_sentiment.get('score', 0):+.2f}).")

    text, source = " ".join(lines), "template"
    if use_llm and llm.available():
        out = llm.complete(
            "Write a 4-6 sentence market wrap for a retail investor who is "
            "learning. Use ONLY these facts, invent nothing, add no forecast and "
            "no recommendations. End with one sentence on what would change the "
            "picture.\n\n"
            f"FACTS: regime={regime}, sectors={sectors[:5]}, "
            f"gainers={movers.get('gainers', [])[:3]}, "
            f"losers={movers.get('losers', [])[:3]}, "
            f"news_sentiment={market_sentiment}",
            system="Financial journalist. Neutral, factual, no hype, never fabricate.",
            max_tokens=420,
        )
        if out and len(out) > 120:
            text, source = out, f"llm:{llm.provider_name()}"

    return {"market": market, "text": text, "source": source,
            "ts": datetime.now(timezone.utc).isoformat(timespec="seconds")}
