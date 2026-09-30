"""Officially disclosed corporate filings and transactions.

This is the legitimate version of "early information": material facts that
companies and insiders are *legally required to publish*, which often reach
the tape before the news cycle digests them.

It is emphatically NOT inside information. Everything here is filed with a
regulator and publicly available the moment it is posted. Acting on genuine
material non-public information is illegal under SEC Rule 10b-5 and SEBI
(Prohibition of Insider Trading) Regulations, and this project will not help
with it.

Sources
-------
US : SEC EDGAR current-filings Atom feeds -- Form 4 (insider transactions by
     officers, directors and 10% holders) and 8-K (material events). Free,
     official, no key, but the SEC returns 403 unless the User-Agent carries a
     contact email, so set SEC_CONTACT_EMAIL to enable it.
IN : NSE and BSE block datacenter IP ranges, so their APIs are unreachable
     from GitHub Actions. Falls back to Moneycontrol's bulk/block deal feed
     and targeted Google News queries over disclosure language. Less
     complete, still public, and clearly labelled as second-hand.
"""
from __future__ import annotations

import hashlib
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import quote_plus

import feedparser
import requests

import config
from config import HTTP_TIMEOUT

# The SEC rejects requests (403) unless the User-Agent carries a real contact
# email. Nothing is hardcoded here -- set SEC_CONTACT_EMAIL and the feed turns
# on. Your address goes only to sec.gov, in the header their policy requires.
def sec_headers() -> dict[str, str] | None:
    if not config.SEC_CONTACT_EMAIL:
        return None
    return {
        "User-Agent": f"market-desk/1.0 ({config.SEC_CONTACT_EMAIL})",
        "Accept-Encoding": "gzip, deflate",
    }


def sec_enabled() -> bool:
    return bool(config.SEC_CONTACT_EMAIL)
BROWSER_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
              "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36")

EDGAR_CURRENT = "https://www.sec.gov/cgi-bin/browse-edgar"
TICKER_MAP_URL = "https://www.sec.gov/files/company_tickers.json"

FORM_MEANING = {
    "4": "Insider transaction (officer, director or 10% holder) — disclosed to the SEC",
    "8-K": "Material event the company must report within four business days",
    "SC 13D": "Activist stake above 5% — the filer intends to influence the company",
    "SC 13G": "Passive stake above 5%",
}

_cik_to_ticker: dict[str, str] | None = None


def _clean(text: str | None) -> str:
    if not text:
        return ""
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", text)).strip()


def _uid(*parts) -> str:
    return hashlib.sha1("|".join(str(p) for p in parts).encode()).hexdigest()[:20]


def cik_ticker_map() -> dict[str, str]:
    """CIK -> ticker, so an EDGAR filing can be attributed to a symbol."""
    global _cik_to_ticker
    if _cik_to_ticker is not None:
        return _cik_to_ticker
    headers = sec_headers()
    if headers is None:
        _cik_to_ticker = {}
        return _cik_to_ticker
    try:
        resp = requests.get(TICKER_MAP_URL, headers=headers, timeout=HTTP_TIMEOUT)
        resp.raise_for_status()
        _cik_to_ticker = {
            str(row["cik_str"]).zfill(10): row["ticker"]
            for row in resp.json().values()
        }
    except Exception as exc:  # noqa: BLE001 - attribution is a bonus, not required
        print(f"[disclosures] SEC ticker map unavailable: {exc}")
        _cik_to_ticker = {}
    return _cik_to_ticker


def _edgar(form_type: str, count: int = 60) -> list[dict]:
    params = {
        "action": "getcurrent", "type": form_type, "company": "", "dateb": "",
        "owner": "include", "count": count, "output": "atom",
    }
    headers = sec_headers()
    if headers is None:
        return []
    try:
        resp = requests.get(EDGAR_CURRENT, params=params, headers=headers,
                            timeout=HTTP_TIMEOUT)
        resp.raise_for_status()
    except Exception as exc:  # noqa: BLE001
        print(f"[disclosures] EDGAR {form_type} failed: {exc}")
        return []

    feed = feedparser.parse(resp.content)
    cik_map = cik_ticker_map()
    out = []
    for entry in feed.entries:
        title = _clean(getattr(entry, "title", ""))
        if not title:
            continue
        # EDGAR titles look like: "4 - DOE JOHN (0001234567) (Reporting)"
        ciks = re.findall(r"\((\d{10})\)", title)
        ticker = next((cik_map[c] for c in ciks if c in cik_map), None)
        company = re.sub(r"^\S+\s*-\s*", "", title).split(" (")[0].strip()

        published = getattr(entry, "updated_parsed", None) or getattr(entry, "published_parsed", None)
        when = (datetime(*published[:6], tzinfo=timezone.utc) if published
                else datetime.now(timezone.utc))

        headline = (f"{company}: {form_type} filed"
                    + (f" — {ticker}" if ticker else ""))
        out.append({
            "id": _uid(getattr(entry, "link", ""), title),
            "symbol": ticker or "__MARKET__",
            "market": "US",
            "published": when.isoformat(timespec="seconds"),
            "title": headline[:400],
            "link": (getattr(entry, "link", "") or "")[:600],
            "source": f"SEC EDGAR ({form_type})",
            "summary": f"{FORM_MEANING.get(form_type, 'SEC filing')}. {title}"[:600],
            "kind": "filing",
            "form_type": form_type,
            "tickers": [ticker] if ticker else [],
            "event_type": {"4": "insider_txn", "8-K": "material_event",
                           "SC 13D": "stake_change", "SC 13G": "stake_change"}.get(form_type),
        })
    return out


def us_filings(forms: tuple[str, ...] = ("4", "8-K"), per_form: int = 60) -> list[dict]:
    if not sec_enabled():
        print("[disclosures] SEC_CONTACT_EMAIL not set; skipping EDGAR "
              "(the SEC returns 403 without a contact email in the User-Agent)")
        return []
    items: list[dict] = []
    for form in forms:
        items += _edgar(form, per_form)
    return items


# --- India ----------------------------------------------------------------
IN_DISCLOSURE_FEEDS = [
    ("Moneycontrol Bulk/Block deals", "https://www.moneycontrol.com/rss/buzzingstocks.xml"),
    ("Moneycontrol Results", "https://www.moneycontrol.com/rss/results.xml"),
    ("Business Standard Companies", "https://www.business-standard.com/rss/companies-101.rss"),
    ("LiveMint Companies", "https://www.livemint.com/rss/companies"),
    ("ET Stocks", "https://economictimes.indiatimes.com/markets/stocks/rssfeeds/2146842.cms"),
]

IN_DISCLOSURE_QUERIES = [
    ('"bulk deal" OR "block deal" NSE', "Exchange-reported large trades"),
    ('"insider trading" disclosure OR "promoter stake" change NSE', "Disclosed insider and promoter dealings"),
    ('"pledged shares" OR "share pledge" promoter NSE', "Promoter share pledges"),
    ('"open offer" OR "acquisition" SEBI NSE', "Takeover-code actions"),
    ('brokerage "target price" upgrade OR downgrade NSE', "Broker rating actions"),
]


def _parse_feed(url: str, source: str, market: str, cutoff: datetime,
                kind: str, limit: int, note: str = "") -> list[dict]:
    try:
        resp = requests.get(url, headers={"User-Agent": BROWSER_UA}, timeout=HTTP_TIMEOUT)
        feed = feedparser.parse(resp.content)
    except Exception as exc:  # noqa: BLE001
        print(f"[disclosures] {source} failed: {exc}")
        return []

    out = []
    for entry in feed.entries[:limit]:
        parsed = getattr(entry, "published_parsed", None) or getattr(entry, "updated_parsed", None)
        when = datetime(*parsed[:6], tzinfo=timezone.utc) if parsed else datetime.now(timezone.utc)
        if when < cutoff:
            continue
        title = _clean(getattr(entry, "title", ""))
        if not title:
            continue
        out.append({
            "id": _uid(getattr(entry, "link", ""), title),
            "symbol": "__MARKET__",
            "market": market,
            "published": when.isoformat(timespec="seconds"),
            "title": title[:400],
            "link": (getattr(entry, "link", "") or "")[:600],
            "source": source,
            "summary": (note + " " + _clean(getattr(entry, "summary", "")))[:600],
            "kind": kind,
        })
    return out


def in_disclosures(days: int = 5, limit: int = 30) -> list[dict]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    items: list[dict] = []
    for source, url in IN_DISCLOSURE_FEEDS:
        items += _parse_feed(url, source, "IN", cutoff, "disclosure", limit)
    for query, note in IN_DISCLOSURE_QUERIES:
        url = (f"https://news.google.com/rss/search?q={quote_plus(query)}"
               f"+when:{days}d&hl=en-IN&gl=IN&ceid=IN:en")
        items += _parse_feed(url, "Google News (disclosures)", "IN", cutoff,
                             "disclosure", limit, note)
    return items


def fetch(market: str, days: int = 5) -> list[dict]:
    """All disclosure-grade items for a market."""
    if market == "US":
        return us_filings()
    return in_disclosures(days=days)
