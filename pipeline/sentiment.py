"""News sentiment.

VADER alone mis-reads finance ("beat", "miss", "cut", "downgrade" are neutral
to it), so a Loughran-McDonald-style finance lexicon is layered on top. An LLM
pass is optional and only re-scores headlines the lexicon is unsure about,
which keeps free-tier token use tiny.
"""
from __future__ import annotations

from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

import llm

_vader = SentimentIntensityAnalyzer()

# Finance-specific polarity. Values are VADER-scale (-4..4) valence overrides.
FINANCE_LEXICON = {
    # bullish
    "beat": 2.4, "beats": 2.4, "outperform": 2.6, "upgrade": 2.8, "upgraded": 2.8,
    "surge": 2.8, "surged": 2.8, "soar": 3.0, "soared": 3.0, "rally": 2.4,
    "rallied": 2.4, "jump": 2.0, "jumped": 2.0, "record": 1.8, "profit": 1.6,
    "buyback": 2.2, "dividend": 1.4, "bullish": 2.6, "breakout": 2.2,
    "expansion": 1.6, "orderbook": 1.4, "bags": 1.8, "wins": 2.0, "bagged": 1.8,
    "approval": 2.0, "approved": 2.0, "stake": 0.6, "acquire": 1.2,
    "acquisition": 1.2, "merger": 1.0, "guidance raise": 3.0, "raises": 1.8,
    "multibagger": 2.4, "target price": 0.8, "accumulate": 1.6, "rerating": 2.0,
    # bearish
    "miss": -2.4, "missed": -2.4, "misses": -2.4, "downgrade": -2.8,
    "downgraded": -2.8, "underperform": -2.6, "plunge": -3.0, "plunged": -3.0,
    "slump": -2.6, "slumped": -2.6, "crash": -3.4, "tumble": -2.8,
    "tumbled": -2.8, "fell": -1.6, "falls": -1.6, "loss": -2.0, "losses": -2.0,
    "bearish": -2.6, "probe": -2.2, "raid": -2.6, "fraud": -3.6, "scam": -3.6,
    "penalty": -2.4, "fine": -1.8, "lawsuit": -2.2, "recall": -2.4,
    "resign": -2.0, "resigns": -2.0, "resignation": -2.0, "default": -3.2,
    "insolvency": -3.4, "downtrend": -2.0, "cut": -1.6, "cuts": -1.6,
    "layoff": -2.2, "layoffs": -2.2, "warning": -2.0, "weak": -1.8,
    "slowdown": -2.2, "sebi": -0.8, "gst notice": -2.4, "pledge": -1.6,
    "selloff": -2.4, "delisting": -2.8, "impairment": -2.2, "writedown": -2.4,
}
_vader.lexicon.update(FINANCE_LEXICON)

# Unsure band -> worth an LLM opinion if one is configured.
_AMBIGUOUS = (-0.15, 0.15)


def label_for(score: float) -> str:
    if score >= 0.35:
        return "bullish"
    if score >= 0.1:
        return "mildly bullish"
    if score <= -0.35:
        return "bearish"
    if score <= -0.1:
        return "mildly bearish"
    return "neutral"


def score_text(text: str) -> float:
    if not text:
        return 0.0
    return float(_vader.polarity_scores(text)["compound"])


def score_items(items: list[dict], use_llm: bool = True,
                llm_budget: int = 40) -> list[dict]:
    """Score in place. Returns the same list with sentiment fields filled."""
    ambiguous: list[dict] = []
    for it in items:
        text = f"{it.get('title', '')}. {it.get('summary', '')}".strip()
        score = score_text(text)
        it["sentiment"] = round(score, 4)
        it["sentiment_label"] = label_for(score)
        it["scored_by"] = "lexicon"
        if _AMBIGUOUS[0] < score < _AMBIGUOUS[1]:
            ambiguous.append(it)

    if use_llm and llm.available() and ambiguous:
        _llm_rescore(ambiguous[:llm_budget])
    return items


def _llm_rescore(items: list[dict]) -> None:
    headlines = [
        {"i": idx, "h": (it.get("title") or "")[:200], "sym": it.get("symbol", "")}
        for idx, it in enumerate(items)
    ]
    prompt = (
        "Score each headline for its likely effect on that company's share price "
        "over the next 5 trading days.\n"
        "Return ONLY a JSON array: [{\"i\": <index>, \"s\": <float -1..1>}]\n"
        "-1 = strongly negative, 0 = no price impact, 1 = strongly positive.\n"
        "Routine coverage with no new information scores 0.\n\n"
        f"{headlines}"
    )
    result = llm.complete_json(
        prompt,
        system="You are a sell-side equity analyst. Output JSON only, no prose.",
        max_tokens=1200,
    )
    if not isinstance(result, list):
        return
    for row in result:
        try:
            idx, score = int(row["i"]), float(row["s"])
        except (KeyError, TypeError, ValueError):
            continue
        if 0 <= idx < len(items):
            score = max(-1.0, min(1.0, score))
            items[idx]["sentiment"] = round(score, 4)
            items[idx]["sentiment_label"] = label_for(score)
            items[idx]["scored_by"] = f"llm:{llm.provider_name()}"


def aggregate(items: list[dict], half_life_days: float = 3.0,
              now=None) -> dict:
    """Recency-weighted mean. A week-old headline should not outvote today's."""
    import math
    from datetime import datetime, timezone

    if not items:
        return {"score": 0.0, "label": "neutral", "count": 0,
                "bullish": 0, "bearish": 0, "neutral": 0}

    now = now or datetime.now(timezone.utc)
    weighted_sum = weight_total = 0.0
    counts = {"bullish": 0, "bearish": 0, "neutral": 0}

    for it in items:
        score = float(it.get("sentiment") or 0.0)
        try:
            pub = datetime.fromisoformat(it["published"])
            if pub.tzinfo is None:
                pub = pub.replace(tzinfo=timezone.utc)
            age_days = max(0.0, (now - pub).total_seconds() / 86400)
        except (KeyError, TypeError, ValueError):
            age_days = 1.0
        weight = math.pow(0.5, age_days / half_life_days)
        weighted_sum += score * weight
        weight_total += weight

        if score >= 0.1:
            counts["bullish"] += 1
        elif score <= -0.1:
            counts["bearish"] += 1
        else:
            counts["neutral"] += 1

    agg = weighted_sum / weight_total if weight_total else 0.0
    return {
        "score": round(agg, 4),
        "label": label_for(agg),
        "count": len(items),
        **counts,
    }
