"""News ingestion from free RSS feeds -- no API keys, no rate-limit accounts.

Sources are deliberately RSS-only: every endpoint here is a public feed that
does not require registration, which is what keeps the whole project free.
"""
from __future__ import annotations

import hashlib
import re
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import quote_plus

import feedparser

from config import NEWS_WINDOW_DAYS, USER_AGENT

# Market-wide feeds (not tied to one ticker).
MARKET_FEEDS = {
    "IN": [
        ("Moneycontrol", "https://www.moneycontrol.com/rss/marketreports.xml"),
        ("Moneycontrol Business", "https://www.moneycontrol.com/rss/business.xml"),
        ("Economic Times Markets", "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms"),
        ("Business Standard Markets", "https://www.business-standard.com/rss/markets-106.rss"),
        ("LiveMint Markets", "https://www.livemint.com/rss/markets"),
        ("Google News IN", "https://news.google.com/rss/search?q=nifty+OR+sensex+when:2d&hl=en-IN&gl=IN&ceid=IN:en"),
    ],
    "US": [
        ("Yahoo Finance", "https://finance.yahoo.com/news/rssindex"),
        ("CNBC Markets", "https://www.cnbc.com/id/20910258/device/rss/rss.html"),
        ("MarketWatch", "https://feeds.content.dowjones.io/public/rss/mw_topstories"),
        ("Google News US", "https://news.google.com/rss/search?q=stock+market+OR+S%26P+500+when:2d&hl=en-US&gl=US&ceid=US:en"),
    ],
}

# Per-sector Google News queries. Broad enough to catch sector-moving stories
# that never name a tracked ticker (policy, commodity prices, demand data).
SECTOR_QUERIES = {
    "IN": {
        "Banks": "Indian banks OR NBFC OR (RBI AND lending) OR (bank AND NPA)",
        "IT": "Indian IT services OR (TCS OR Infosys OR Wipro) deal OR IT sector hiring",
        "Auto": "India auto sales OR (car OR two-wheeler) sales India OR EV policy India",
        "Pharma": "Indian pharma OR USFDA India plant OR drug approval India",
        "Energy": "India oil gas OR power sector India OR (crude AND India) OR renewable India",
        "Metals": "India steel OR metal prices India OR (aluminium OR copper) India",
        "FMCG": "India FMCG demand OR rural consumption India OR consumer staples India",
        "Financials": "India insurance OR mutual fund India OR housing finance India",
        "Infra": "India infrastructure OR cement demand India OR real estate India OR defence order India",
        "Consumer": "India retail OR quick commerce India OR (jewellery OR apparel) India demand",
    },
    "US": {
        "MegaTech": "big tech earnings OR (Apple OR Microsoft OR Google OR Amazon OR Meta) stock",
        "Semis": "semiconductor stocks OR chip demand OR (Nvidia OR AMD) OR chip export rules",
        "Financials": "US banks OR (Fed AND rates AND banks) OR credit conditions",
        "Healthcare": "US healthcare stocks OR FDA approval OR drug pricing policy",
        "Energy": "oil prices OR US energy stocks OR OPEC output",
        "Consumer": "US consumer spending OR retail sales OR (Walmart OR Costco)",
        "Software": "enterprise software stocks OR SaaS earnings OR cloud spending",
    },
}

_TAG_RE = re.compile(r"<[^>]+>")


def _clean(text: str | None) -> str:
    if not text:
        return ""
    return re.sub(r"\s+", " ", _TAG_RE.sub(" ", text)).strip()


def _entry_time(entry) -> datetime:
    for attr in ("published_parsed", "updated_parsed"):
        parsed = getattr(entry, attr, None)
        if parsed:
            return datetime(*parsed[:6], tzinfo=timezone.utc)
    return datetime.now(timezone.utc)


def _uid(link: str, title: str) -> str:
    return hashlib.sha1(f"{link}|{title}".encode()).hexdigest()[:20]


def _parse(url: str, source: str, symbol: str, market: str,
           cutoff: datetime, limit: int) -> list[dict]:
    try:
        feed = feedparser.parse(url, agent=USER_AGENT)
    except Exception as exc:  # noqa: BLE001 - one dead feed must not kill the run
        print(f"[news] {source} failed: {exc}")
        return []

    items = []
    for entry in feed.entries[:limit]:
        published = _entry_time(entry)
        if published < cutoff:
            continue
        title = _clean(getattr(entry, "title", ""))
        if not title:
            continue
        link = getattr(entry, "link", "") or ""
        items.append({
            "id": _uid(link, title),
            "symbol": symbol,
            "market": market,
            "published": published.isoformat(timespec="seconds"),
            "title": title[:400],
            "link": link[:600],
            "source": source,
            "summary": _clean(getattr(entry, "summary", ""))[:600],
            "sentiment": 0.0,
            "sentiment_label": "neutral",
            "scored_by": "pending",
        })
    return items


def market_news(market: str, days: int = NEWS_WINDOW_DAYS,
                per_feed: int = 40) -> list[dict]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    out: list[dict] = []
    for source, url in MARKET_FEEDS.get(market, []):
        out += _parse(url, source, "__MARKET__", market, cutoff, per_feed)
        time.sleep(0.3)
    return _dedupe(out)


def sector_news(market: str, days: int = NEWS_WINDOW_DAYS,
                limit: int = 15) -> dict[str, list[dict]]:
    """One Google News query per sector. Cheap: a handful of requests total."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    locale = ("hl=en-IN&gl=IN&ceid=IN:en" if market == "IN"
              else "hl=en-US&gl=US&ceid=US:en")
    out: dict[str, list[dict]] = {}
    for sector, query in SECTOR_QUERIES.get(market, {}).items():
        url = (f"https://news.google.com/rss/search?q={quote_plus(query)}"
               f"+when:{days}d&{locale}")
        items = _parse(url, "Google News (sector)", "__MARKET__", market, cutoff, limit)
        for it in items:
            it["sector"] = sector          # query-level attribution, trusted
        out[sector] = _dedupe(items)
        time.sleep(0.35)
    return out


def symbol_news(symbol: str, market: str, company_name: str = "",
                days: int = NEWS_WINDOW_DAYS, limit: int = 20) -> list[dict]:
    """Google News query per ticker. One request, no key, works for NSE names."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    base = symbol.replace(".NS", "").replace("-", " ")
    query = f'"{company_name}"' if company_name and company_name != symbol else base
    if market == "IN":
        query += " (share OR stock OR NSE)"
        locale = "hl=en-IN&gl=IN&ceid=IN:en"
    else:
        query += " (stock OR shares OR earnings)"
        locale = "hl=en-US&gl=US&ceid=US:en"

    url = (f"https://news.google.com/rss/search?q={quote_plus(query)}"
           f"+when:{days}d&{locale}")
    items = _parse(url, "Google News", symbol, market, cutoff, limit)

    # Yahoo's per-ticker feed is a cheap second opinion and covers US best.
    yahoo = (f"https://feeds.finance.yahoo.com/rss/2.0/headline"
             f"?s={quote_plus(symbol)}&region=US&lang=en-US")
    items += _parse(yahoo, "Yahoo Finance", symbol, market, cutoff, limit)
    return _dedupe(items)


def _dedupe(items: list[dict]) -> list[dict]:
    """Collapse syndicated copies, but keep the count.

    How many independent outlets carried a story is a genuine signal about
    whether it matters and whether it is real, so the duplicates are counted
    into `corroboration` rather than thrown away.
    """
    kept: dict[str, dict] = {}
    for it in sorted(items, key=lambda x: x["published"], reverse=True):
        key = re.sub(r"[^a-z0-9]", "", it["title"].lower())[:70]
        if key in kept:
            first = kept[key]
            first["corroboration"] = first.get("corroboration", 1) + 1
            sources = first.setdefault("also_in", [])
            if it["source"] not in sources and it["source"] != first["source"]:
                sources.append(it["source"])
            continue
        it.setdefault("corroboration", 1)
        kept[key] = it
    return list(kept.values())
