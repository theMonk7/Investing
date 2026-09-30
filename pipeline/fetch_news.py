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
    """Same story syndicated across outlets -- collapse on normalised title."""
    seen: set[str] = set()
    out = []
    for it in sorted(items, key=lambda x: x["published"], reverse=True):
        key = re.sub(r"[^a-z0-9]", "", it["title"].lower())[:70]
        if key in seen:
            continue
        seen.add(key)
        out.append(it)
    return out
