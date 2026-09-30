"""Ticker universes and index definitions.

The watchlist is what the user tracks; the *universe* is the wider pool scanned
for "stocks that could move". Both markets keep their own index benchmark so
relative strength is computed against the right thing.
"""
from __future__ import annotations

import json

from config import WATCHLIST_PATH

BENCHMARK = {"IN": "^NSEI", "US": "^GSPC"}
BREADTH_INDEX = {"IN": "^NSEI", "US": "^GSPC"}
VIX = {"IN": "^INDIAVIX", "US": "^VIX"}

CURRENCY = {"IN": "₹", "US": "$"}

# Scanned every run for movers. Nifty-50 heavy + liquid midcaps.
IN_UNIVERSE = [
    "RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "INFY.NS", "ICICIBANK.NS",
    "BHARTIARTL.NS", "SBIN.NS", "LT.NS", "ITC.NS", "AXISBANK.NS",
    "KOTAKBANK.NS", "HINDUNILVR.NS", "BAJFINANCE.NS", "ASIANPAINT.NS",
    "MARUTI.NS", "SUNPHARMA.NS", "TITAN.NS", "ULTRACEMCO.NS", "NESTLEIND.NS",
    "WIPRO.NS", "HCLTECH.NS", "TECHM.NS", "POWERGRID.NS", "NTPC.NS",
    "ONGC.NS", "COALINDIA.NS", "TATASTEEL.NS", "JSWSTEEL.NS", "HINDALCO.NS",
    "TMPV.NS", "M&M.NS", "EICHERMOT.NS", "BAJAJ-AUTO.NS", "HEROMOTOCO.NS",
    "TVSMOTOR.NS",
    "ADANIENT.NS", "ADANIPORTS.NS", "GRASIM.NS", "CIPLA.NS", "DRREDDY.NS",
    "DIVISLAB.NS", "APOLLOHOSP.NS", "BRITANNIA.NS", "TATACONSUM.NS",
    "SHRIRAMFIN.NS", "SBILIFE.NS", "HDFCLIFE.NS", "BAJAJFINSV.NS",
    "INDUSINDBK.NS", "TRENT.NS", "BEL.NS", "IRCTC.NS", "ETERNAL.NS",
    "HAL.NS", "PERSISTENT.NS", "JIOFIN.NS",
    "DMART.NS", "PIDILITIND.NS", "DLF.NS", "VEDL.NS", "IOC.NS", "BPCL.NS",
]

US_UNIVERSE = [
    "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "BRK-B",
    "AVGO", "JPM", "V", "MA", "UNH", "XOM", "LLY", "JNJ", "PG", "HD",
    "COST", "ABBV", "MRK", "AMD", "NFLX", "CRM", "ADBE", "PEP", "KO",
    "WMT", "BAC", "CVX", "ORCL", "INTC", "QCOM", "TXN", "MU", "PLTR",
    "SPY", "QQQ", "DIA", "IWM",
]

# Sector map keeps the rotation view honest without extra API calls.
SECTOR = {
    "IN": {
        "Banks": ["HDFCBANK.NS", "ICICIBANK.NS", "SBIN.NS", "AXISBANK.NS", "KOTAKBANK.NS", "INDUSINDBK.NS"],
        "IT": ["TCS.NS", "INFY.NS", "WIPRO.NS", "HCLTECH.NS", "TECHM.NS", "PERSISTENT.NS"],
        "Auto": ["TMPV.NS", "MARUTI.NS", "M&M.NS", "EICHERMOT.NS", "BAJAJ-AUTO.NS",
                 "HEROMOTOCO.NS", "TVSMOTOR.NS"],
        "Pharma": ["SUNPHARMA.NS", "CIPLA.NS", "DRREDDY.NS", "DIVISLAB.NS"],
        "Energy": ["RELIANCE.NS", "ONGC.NS", "NTPC.NS", "POWERGRID.NS", "COALINDIA.NS", "IOC.NS", "BPCL.NS"],
        "Metals": ["TATASTEEL.NS", "JSWSTEEL.NS", "HINDALCO.NS", "VEDL.NS"],
        "FMCG": ["HINDUNILVR.NS", "ITC.NS", "NESTLEIND.NS", "BRITANNIA.NS", "TATACONSUM.NS", "DMART.NS"],
        "Financials": ["BAJFINANCE.NS", "BAJAJFINSV.NS", "SHRIRAMFIN.NS", "SBILIFE.NS",
                       "HDFCLIFE.NS", "JIOFIN.NS"],
        "Infra": ["LT.NS", "ULTRACEMCO.NS", "GRASIM.NS", "ADANIPORTS.NS", "DLF.NS", "HAL.NS"],
        "Consumer": ["TITAN.NS", "ASIANPAINT.NS", "TRENT.NS", "ETERNAL.NS", "PIDILITIND.NS"],
    },
    "US": {
        "MegaTech": ["AAPL", "MSFT", "GOOGL", "AMZN", "META"],
        "Semis": ["NVDA", "AVGO", "AMD", "INTC", "QCOM", "TXN", "MU"],
        "Financials": ["JPM", "BAC", "V", "MA", "BRK-B"],
        "Healthcare": ["UNH", "LLY", "JNJ", "ABBV", "MRK"],
        "Energy": ["XOM", "CVX"],
        "Consumer": ["PG", "HD", "COST", "PEP", "KO", "WMT"],
        "Software": ["CRM", "ADBE", "ORCL", "PLTR", "NFLX"],
    },
}

_SECTOR_OF: dict[str, str] = {}
for _mkt, _groups in SECTOR.items():
    for _name, _syms in _groups.items():
        for _s in _syms:
            _SECTOR_OF[_s] = _name


def sector_of(symbol: str) -> str:
    return _SECTOR_OF.get(symbol, "Other")


def load_watchlist() -> dict:
    try:
        with open(WATCHLIST_PATH) as fh:
            wl = json.load(fh)
    except (OSError, json.JSONDecodeError):
        wl = {}
    wl.setdefault("version", 1)
    wl.setdefault("IN", [])
    wl.setdefault("US", [])
    wl.setdefault("bookmarks", [])
    wl.setdefault("notes", {})
    return wl


def universe_for(market: str) -> list[str]:
    """Watchlist first (user intent), then the scan pool, de-duplicated."""
    wl = load_watchlist()
    base = IN_UNIVERSE if market == "IN" else US_UNIVERSE
    seen, out = set(), []
    for sym in list(wl.get(market, [])) + base:
        if sym and sym not in seen:
            seen.add(sym)
            out.append(sym)
    return out
