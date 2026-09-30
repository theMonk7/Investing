"""Event classification and ticker matching for news items.

Two jobs:

1. Work out *what kind of thing* a headline reports (earnings, a rating
   change, an order win, a disclosed insider transaction...). Rule-based, so
   it is deterministic and auditable; an LLM can refine the leftovers.
2. Work out *which tracked stocks* a headline is about, so a story can be
   attributed to a sector and, later, to a measured price reaction.

Classification is keyword-driven on purpose. A headline is short and the
vocabulary of market news is small and stable, so patterns beat a model here
and cost nothing.
"""
from __future__ import annotations

import hashlib
import re

import llm
from universe import SECTOR, sector_of

# Ordered: the first pattern that matches wins, so put the specific and the
# market-moving ahead of the generic.
EVENT_PATTERNS: list[tuple[str, str, str]] = [
    ("insider_buy", r"\b(insider|promoter|director|ceo|cfo)\b.{0,40}\b(buy|bought|purchase|acquir|raise[sd]? stake|increase[sd]? stake)",
     "An officer, director or promoter disclosed a purchase"),
    ("insider_sell", r"\b(insider|promoter|director|ceo|cfo)\b.{0,40}\b(sell|sold|sale|offload|pare[sd]? stake|trim|reduce[sd]? stake|pledge)",
     "An officer, director or promoter disclosed a sale or pledge"),
    ("bulk_deal", r"\b(bulk deal|block deal|bulk deals|block deals)\b",
     "A large single-counterparty trade reported by the exchange"),
    ("stake_change", r"\b(stake|shareholding)\b.{0,30}\b(buy|sell|raise|cut|acquire|divest|13d|13g)\b",
     "A disclosed change in a significant holder's position"),
    ("earnings_beat", r"\b(beat|beats|tops|exceed(s|ed)?|above)\b.{0,30}\b(estimat|expectation|forecast|street)",
     "Reported results came in above expectations"),
    ("earnings_miss", r"\b(miss|misses|missed|below|short of|lags?)\b.{0,30}\b(estimat|expectation|forecast|street)",
     "Reported results came in below expectations"),
    ("earnings", r"\b(q[1-4]|quarter(ly)?|results|earnings|profit|revenue|pat|ebitda|net income)\b",
     "A results announcement or reporting-related story"),
    ("guidance", r"\b(guidance|outlook|forecast)\b.{0,25}\b(raise|cut|lower|rais|trim|hike|revis)",
     "The company changed its own forward guidance"),
    ("upgrade", r"\b(upgrade[sd]?|raises target|hikes target|initiate[sd]? .{0,15}buy|outperform|overweight|accumulate)\b",
     "A broker raised its rating or price target"),
    ("downgrade", r"\b(downgrade[sd]?|cuts target|lowers target|underperform|underweight|reduce rating|sell rating)\b",
     "A broker lowered its rating or price target"),
    ("order_win", r"\b(order|contract|deal|tender|mandate|lou|loi)\b.{0,25}\b(win|won|wins|bag|bags|bagged|secure[sd]?|award(ed)?|receive[sd]?)\b",
     "A new order, contract or mandate"),
    ("mna", r"\b(merger|acquisition|acquire[sd]?|takeover|buyout|demerger|amalgamation|open offer)\b",
     "A merger, acquisition or corporate restructuring"),
    ("buyback", r"\b(buyback|buy-back|share repurchase)\b", "A share repurchase"),
    ("dividend", r"\b(dividend|interim dividend|record date|bonus issue|stock split)\b",
     "A distribution or capital action"),
    ("fundraise", r"\b(qip|rights issue|ipo|fpo|preferential|raise[sd]? .{0,15}(crore|billion|million)|ncd|debenture|bond issue)\b",
     "The company raised capital"),
    ("regulatory", r"\b(sebi|rbi|cci|sec |ftc|doj|dgft|cbi|ed |enforcement directorate|probe|investigation|show cause|penalty|fine[sd]?|notice|raid|search)\b",
     "A regulator or enforcement body is involved"),
    ("legal", r"\b(lawsuit|sues?|sued|litigation|court|tribunal|nclt|verdict|arbitration|insolvency|bankrupt)\b",
     "A legal or insolvency proceeding"),
    ("management", r"\b(resign|resigns|resignation|steps down|appoint(s|ed|ment)?|new ceo|new cfo|elevat|succeed)\b",
     "A change in senior management or the board"),
    ("product", r"\b(launch(es|ed)?|unveil|new product|approval|approved|clearance|patent|usfda|fda)\b",
     "A product, approval or intellectual-property development"),
    ("capacity", r"\b(capex|expansion|new plant|capacity|facility|factory|commission(ed|ing)?)\b",
     "Capital expenditure or capacity change"),
    ("rating_agency", r"\b(crisil|icra|care ratings|moody|s&p|fitch)\b.{0,30}\b(rating|upgrade|downgrade|outlook)\b",
     "A credit-rating action"),
    ("macro", r"\b(inflation|gdp|repo rate|fed|fomc|rbi policy|budget|gst|tariff|crude|rupee|dollar index|bond yield)\b",
     "A macroeconomic development rather than a company event"),
]

# Directional prior used only for display ordering, never fed to the model.
EVENT_TONE = {
    "insider_buy": "bullish", "earnings_beat": "bullish", "upgrade": "bullish",
    "order_win": "bullish", "buyback": "bullish",
    "insider_sell": "bearish", "earnings_miss": "bearish", "downgrade": "bearish",
    "regulatory": "bearish", "legal": "bearish",
}

EVENT_LABEL = {name: name.replace("_", " ") for name, _, _ in EVENT_PATTERNS}
EVENT_MEANING = {name: meaning for name, _, meaning in EVENT_PATTERNS}

_COMPILED = [(name, re.compile(pattern, re.I)) for name, pattern, _ in EVENT_PATTERNS]

# Events worth surfacing as catalysts. The rest are context.
HIGH_IMPACT = {
    "earnings_beat", "earnings_miss", "guidance", "upgrade", "downgrade",
    "insider_buy", "insider_sell", "bulk_deal", "mna", "regulatory",
    "order_win", "buyback", "stake_change",
}


def classify(text: str) -> str | None:
    for name, pattern in _COMPILED:
        if pattern.search(text):
            return name
    return None


# --- ticker matching -------------------------------------------------------
_STOPWORDS = {"THE", "AND", "FOR", "NEW", "INDIA", "LTD", "LIMITED", "INC",
              "CORP", "GROUP", "CO", "PLC", "IPO", "CEO", "CFO", "GDP", "USA"}


def _aliases(symbol: str, name: str = "") -> list[str]:
    """Surface forms a headline might use for this ticker."""
    base = symbol.replace(".NS", "").replace(".BO", "")
    out = {base}
    if name and name.upper() != base:
        cleaned = re.sub(r"\b(ltd|limited|inc|corp(oration)?|plc|co|company|"
                         r"the|&|and|group|industries|india)\b\.?", " ",
                         name, flags=re.I)
        cleaned = re.sub(r"[^A-Za-z0-9 ]", " ", cleaned).strip()
        if len(cleaned) >= 4:
            out.add(cleaned)
    return [a for a in out if len(a) >= 3 and a.upper() not in _STOPWORDS]


def build_matcher(symbols: list[str], names: dict[str, str]) -> list[tuple[str, re.Pattern]]:
    matcher = []
    for sym in symbols:
        forms = _aliases(sym, names.get(sym, ""))
        if not forms:
            continue
        pattern = "|".join(re.escape(f) for f in sorted(forms, key=len, reverse=True))
        matcher.append((sym, re.compile(rf"\b({pattern})\b", re.I)))
    return matcher


def match_tickers(text: str, matcher) -> list[str]:
    return [sym for sym, pattern in matcher if pattern.search(text)]


# --- sector attribution ----------------------------------------------------
SECTOR_KEYWORDS = {
    "Banks": r"\b(bank|banking|nbfc|lender|credit growth|npa|casa|psu bank)\b",
    "IT": r"\b(it services|software|infotech|tech services|saas|cloud|ai deal|outsourc)\b",
    "Auto": r"\b(auto|automobile|car|two-wheeler|ev |electric vehicle|passenger vehicle|commercial vehicle)\b",
    "Pharma": r"\b(pharma|drug|usfda|api |formulation|generic|healthcare|hospital)\b",
    "Energy": r"\b(oil|gas|crude|refinery|power|electricity|renewable|solar|coal|opec)\b",
    "Metals": r"\b(steel|metal|aluminium|aluminum|copper|zinc|iron ore|mining)\b",
    "FMCG": r"\b(fmcg|consumer goods|staples|food|beverage|retail sales)\b",
    "Financials": r"\b(insurance|amc |mutual fund|nbfc|housing finance|fintech|payments)\b",
    "Infra": r"\b(infrastructure|cement|construction|real estate|realty|ports|logistics|defence)\b",
    "Consumer": r"\b(consumer discretionary|apparel|jewellery|quick commerce|e-commerce|hotels|travel)\b",
    "Semis": r"\b(semiconductor|chip|foundry|gpu|wafer)\b",
    "MegaTech": r"\b(big tech|iphone|android|search ads|social media)\b",
    "Software": r"\b(enterprise software|subscription|saas)\b",
    "Healthcare": r"\b(health insurance|biotech|medicare|clinical trial)\b",
}
_SECTOR_RE = {k: re.compile(v, re.I) for k, v in SECTOR_KEYWORDS.items()}


def attribute_sector(text: str, tickers: list[str], market: str) -> str:
    """Ticker match wins; keywords are the fallback for market-wide stories."""
    for sym in tickers:
        sector = sector_of(sym)
        if sector != "Other":
            return sector
    valid = set(SECTOR.get(market, {}))
    for sector, pattern in _SECTOR_RE.items():
        if sector in valid and pattern.search(text):
            return sector
    return "Market-wide"


# --- enrichment ------------------------------------------------------------
def enrich(items: list[dict], matcher, market: str,
           use_llm: bool = False, llm_budget: int = 30) -> list[dict]:
    """Attach event_type, tickers and sector to each item, in place."""
    unclassified = []
    for it in items:
        text = f"{it.get('title', '')}. {it.get('summary', '')}"
        tickers = match_tickers(text, matcher)
        # A per-ticker feed already knows its subject.
        if it.get("symbol") and it["symbol"] not in ("__MARKET__", "") and it["symbol"] not in tickers:
            tickers.insert(0, it["symbol"])
        it["tickers"] = tickers
        it["event_type"] = classify(text)
        it["sector"] = attribute_sector(text, tickers, market)
        if not it["event_type"]:
            unclassified.append(it)

    if use_llm and llm.available() and unclassified:
        _llm_classify(unclassified[:llm_budget])
    return items


def _llm_classify(items: list[dict]) -> None:
    types = sorted({name for name, _, _ in EVENT_PATTERNS})
    payload = [{"i": i, "h": (it.get("title") or "")[:180]} for i, it in enumerate(items)]
    result = llm.complete_json(
        "Classify each headline into exactly one event type from this list, or "
        "null if none apply. Do not invent types.\n"
        f"TYPES: {types}\n"
        'Return ONLY: [{"i": <index>, "t": "<type or null>"}]\n\n'
        f"{payload}",
        system="Financial news classifier. Output JSON only.",
        max_tokens=1000,
    )
    if not isinstance(result, list):
        return
    valid = {name for name, _, _ in EVENT_PATTERNS}
    for row in result:
        try:
            idx, kind = int(row["i"]), row.get("t")
        except (KeyError, TypeError, ValueError):
            continue
        if 0 <= idx < len(items) and kind in valid:
            items[idx]["event_type"] = kind


def event_id(symbol: str, event_type: str, date: str) -> str:
    return hashlib.sha1(f"{symbol}|{event_type}|{date}".encode()).hexdigest()[:20]
