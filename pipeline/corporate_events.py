"""Corporate event calendar: results dates, board meetings, dividends, splits.

Sources, most authoritative first
---------------------------------
IN : NSE corporate filings API. SEBI LODR Reg. 29 obliges every listed company
     to tell the exchange in advance when its board will meet to consider
     results, dividends, buybacks, fund raising and so on. The exchange
     publishes those intimations (with the filed PDF) and the resulting
     corporate actions (ex / record dates). This is the same data broker apps
     such as Groww show. RBI does not publish company events -- the exchanges
     are the primary source.
     NSE sometimes refuses cloud IP ranges, so every run also asks Yahoo
     Finance for tracked symbols; those rows are marked unofficial and are
     dropped wherever an exchange filing covers the same event.
US : Nasdaq's public earnings and dividend calendars (all US listings,
     filtered to large caps plus anything tracked), with Yahoo as fallback.

Events are kept in SQLite so a source that is down on one run does not empty
the calendar; data/<market>/events.json is re-exported every run.
"""
from __future__ import annotations

import hashlib
import json
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests

from store import corp_events_between, get_meta, save_corp_events, set_meta

TIMEOUT = 15
BROWSER_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
              "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36")
NSE_API = "https://www.nseindia.com/api/"
NSE_HEADERS = {"User-Agent": BROWSER_UA, "Accept": "application/json",
               "Referer": "https://www.nseindia.com/"}
NASDAQ_API = "https://api.nasdaq.com/api/calendar/"
NASDAQ_HEADERS = {"User-Agent": BROWSER_UA, "Accept": "application/json",
                  "Origin": "https://www.nasdaq.com",
                  "Referer": "https://www.nasdaq.com/"}
US_MIN_CAP = 10e9         # untracked US names below this are skipped
EXPORT_BACK, EXPORT_AHEAD = 30, 90

# Order matters only for the title: the first matching label leads.
TYPE_RULES = [
    ("results", r"financial result|quarterly result|audited|results?\b"),
    ("dividend", r"dividend"),
    ("bonus", r"\bbonus\b"),
    ("split", r"split|sub-?division"),
    ("buyback", r"buy ?-?back"),
    ("fundraise", r"fund ?rais|preferential|\bqip\b|rights issue|\bncds?\b|"
                  r"debenture|warrant|private placement|capital rais"),
    ("merger", r"merger|amalgamation|demerger|scheme of arrangement|acquisition"),
    ("agm", r"\bagm\b|\begm\b|annual general|extra-?ordinary general|postal ballot"),
]
TYPE_LABEL = {"results": "Results", "dividend": "Dividend", "bonus": "Bonus",
              "split": "Split", "buyback": "Buyback", "fundraise": "Fund raising",
              "merger": "Restructuring", "agm": "Shareholder meeting",
              "board_meeting": "Board meeting", "other": "Other"}
SKIP_ACTIONS = re.compile(r"interest payment|redemption|annual listing fee", re.I)


def classify(text: str) -> list[str]:
    text = (text or "").lower()
    return [name for name, rx in TYPE_RULES if re.search(rx, text)]


def _iso(d: date) -> str:
    return d.isoformat()


def _parse_date(value, fmts=("%d-%b-%Y", "%m/%d/%Y", "%Y-%m-%d")) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip()[:11]
    for fmt in fmts:
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def _short(text: str, n: int = 160) -> str:
    text = re.sub(r"\s+", " ", text or "").strip()
    return text if len(text) <= n else text[: n - 1].rstrip() + "…"


def _digest(text: str) -> str:
    return hashlib.sha1((text or "").encode()).hexdigest()[:6]


def _event(market, symbol, company, day, types, title, *, kind, detail="",
           source, link="", official, **extra) -> dict:
    ev = {"id": f"{market}:{symbol}:{_iso(day)}:{kind}", "market": market,
          "symbol": symbol, "company": company or "", "date": _iso(day),
          "types": types or ["other"], "title": title, "detail": _short(detail),
          "source": source, "link": link, "official": official}
    ev.update({k: v for k, v in extra.items() if v})
    return ev


def _title(types: list[str], lead: str = "") -> str:
    labels = [TYPE_LABEL[t] for t in types if t != "board_meeting"]
    if lead:
        return f"{lead} · {', '.join(labels)}" if labels else lead
    return ", ".join(labels) or "Corporate event"


# --- NSE ---------------------------------------------------------------------

class _NSE:
    """Tiny client: tries bare API calls, warms cookies once if refused."""

    def __init__(self):
        self.s = requests.Session()
        self.s.headers.update(NSE_HEADERS)
        self.warmed = False

    def get(self, path: str, params: dict):
        for attempt in range(2):
            r = self.s.get(NSE_API + path, params=params, timeout=TIMEOUT)
            if r.status_code in (401, 403) and not self.warmed:
                self.warmed = True
                try:
                    self.s.get("https://www.nseindia.com/", timeout=TIMEOUT)
                except requests.RequestException:
                    pass
                continue
            r.raise_for_status()
            data = r.json()
            return data.get("data", data) if isinstance(data, dict) else data
        raise RuntimeError(f"NSE refused {path} ({r.status_code})")


_BM_PREFIX = re.compile(r"^.*?has informed the Exchange about Board Meeting to be held "
                        r"on \S+ to ", re.I)


def nse_board_meeting(row: dict) -> dict | None:
    day = _parse_date(row.get("bm_date"))
    sym = (row.get("bm_symbol") or "").strip()
    if not day or not sym:
        return None
    purpose, desc = row.get("bm_purpose") or "", row.get("bm_desc") or ""
    types = classify(f"{purpose} {desc}")
    detail = _BM_PREFIX.sub("", desc)
    detail = detail[:1].upper() + detail[1:]
    return _event("IN", f"{sym}.NS", row.get("sm_name"), day,
                  ["board_meeting", *types], _title(types, "Board meeting"),
                  kind="bm", detail=detail, source="NSE",
                  link=row.get("attachment") or "", official=True,
                  industry=row.get("sm_indusrty"), announced=row.get("bm_timestamp"))


def nse_corporate_action(row: dict) -> dict | None:
    subject = (row.get("subject") or "").strip()
    day = _parse_date(row.get("exDate"))
    sym = (row.get("symbol") or "").strip()
    if not day or not sym or not subject or SKIP_ACTIONS.search(subject):
        return None
    if row.get("series") not in (None, "", "EQ", "BE", "BZ", "SM", "ST"):
        return None
    types = classify(subject) or ["other"]
    rec = row.get("recDate")
    detail = f"Ex-date {row.get('exDate')}" + (f" · record date {rec}" if rec and rec != "-" else "")
    return _event("IN", f"{sym}.NS", row.get("comp"), day, types, subject,
                  kind=f"ca{_digest(subject)}", detail=detail, source="NSE",
                  official=True, exdate=True)


def _chunks(start: date, end: date, days: int = 30):
    while start <= end:
        stop = min(end, start + timedelta(days=days - 1))
        yield start, stop
        start = stop + timedelta(days=1)


def nse_window(start: date, end: date, client: _NSE | None = None) -> tuple[list, list]:
    client = client or _NSE()
    meetings, actions = [], []
    for a, b in _chunks(start, end):
        params = {"index": "equities", "from_date": a.strftime("%d-%m-%Y"),
                  "to_date": b.strftime("%d-%m-%Y")}
        meetings += [e for e in map(nse_board_meeting,
                                    client.get("corporate-board-meetings", params)) if e]
    params = {"index": "equities", "from_date": start.strftime("%d-%m-%Y"),
              "to_date": end.strftime("%d-%m-%Y")}
    actions = [e for e in map(nse_corporate_action,
                              client.get("corporates-corporateActions", params)) if e]
    return meetings, actions


def nse_symbol(symbol: str, client: _NSE | None = None) -> list[dict]:
    client = client or _NSE()
    base = symbol.split(".")[0]
    rows = [nse_board_meeting(r) for r in
            client.get("corporate-board-meetings", {"index": "equities", "symbol": base})]
    rows += [nse_corporate_action(r) for r in
             client.get("corporates-corporateActions", {"index": "equities", "symbol": base})]
    return [e for e in rows if e]


# --- Nasdaq (US) ---------------------------------------------------------------

def _cap(text) -> float:
    try:
        return float(re.sub(r"[^\d.]", "", str(text)) or 0)
    except ValueError:
        return 0.0


def _nasdaq(kind: str, day: date):
    r = requests.get(NASDAQ_API + kind, params={"date": _iso(day)},
                     headers=NASDAQ_HEADERS, timeout=TIMEOUT)
    r.raise_for_status()
    return (r.json() or {}).get("data") or {}


def nasdaq_earnings_row(row: dict, day: date) -> dict:
    sym = (row.get("symbol") or "").strip().upper()
    when = {"time-pre-market": "before open", "time-after-hours": "after close"}.get(
        row.get("time") or "")
    quarter = row.get("fiscalQuarterEnding") or ""
    bits = []
    if row.get("epsForecast"):
        bits.append(f"EPS est {row['epsForecast']}"
                    + (f" ({row['noOfEsts']} analysts)" if row.get("noOfEsts") else ""))
    if row.get("lastYearEPS"):
        bits.append(f"year-ago {row['lastYearEPS']}")
    return _event("US", sym, row.get("name"), day, ["results"],
                  f"Earnings{' · quarter ending ' + quarter if quarter else ''}",
                  kind="er", detail=" · ".join(bits), source="Nasdaq",
                  official=True, time=when)


def nasdaq_earnings(start: date, end: date, tracked: set[str]) -> list[dict]:
    days = [start + timedelta(n) for n in range((end - start).days + 1)]
    days = [d for d in days if d.weekday() < 5]

    def one(day):
        rows = (_nasdaq("earnings", day).get("rows") or [])
        return [nasdaq_earnings_row(r, day) for r in rows
                if (r.get("symbol") or "").upper() in tracked or _cap(r.get("marketCap")) >= US_MIN_CAP]

    out, errors = [], 0
    with ThreadPoolExecutor(max_workers=8) as pool:
        for fut in [pool.submit(one, d) for d in days]:
            try:
                out += fut.result()
            except Exception:  # noqa: BLE001 -- one bad day must not sink the rest
                errors += 1
    if errors and not out:
        raise RuntimeError(f"Nasdaq earnings: all {errors} day requests failed")
    return out


def nasdaq_dividends(start: date, end: date, tracked: set[str]) -> list[dict]:
    out = []
    for n in range((end - start).days + 1):
        day = start + timedelta(n)
        if day.weekday() >= 5:
            continue
        rows = ((_nasdaq("dividends", day).get("calendar") or {}).get("rows") or [])
        for r in rows:
            sym = (r.get("symbol") or "").strip().upper()
            ex = _parse_date(r.get("dividend_Ex_Date"))
            if sym not in tracked or not ex:
                continue
            pay = r.get("payment_Date") or ""
            out.append(_event("US", sym, r.get("companyName"), ex, ["dividend"],
                              f"Ex-dividend ${r.get('dividend_Rate')}",
                              kind="dv", detail=f"Pays {pay}" if pay else "",
                              source="Nasdaq", official=True, exdate=True))
    return out


# --- Yahoo fallback --------------------------------------------------------------

def yahoo_calendar(symbols: list[str], market: str, names: dict | None = None) -> list[dict]:
    import yfinance as yf

    names = names or {}
    out = []
    for sym in symbols[:40]:
        try:
            cal = yf.Ticker(sym).calendar or {}
        except Exception:  # noqa: BLE001
            continue
        if not isinstance(cal, dict):
            continue
        earn = cal.get("Earnings Date") or []
        earn = earn if isinstance(earn, (list, tuple)) else [earn]
        day = _parse_date(earn[0]) if earn else None
        if day:
            out.append(_event(market, sym, names.get(sym), day, ["results"],
                              "Results (expected)", kind="yfer", source="Yahoo Finance",
                              detail="Estimated date; confirm against the exchange filing.",
                              official=False, estimated=True))
        ex = _parse_date(cal.get("Ex-Dividend Date"))
        if ex:
            out.append(_event(market, sym, names.get(sym), ex, ["dividend"], "Ex-dividend",
                              kind="yfdv", source="Yahoo Finance", official=False,
                              exdate=True))
    return out


# --- orchestration -----------------------------------------------------------------

def _record(cx, market: str, results: list[dict]) -> list[dict]:
    """Merge this run's per-source outcome into the persisted status."""
    key = f"events_sources:{market}"
    saved = {s["name"]: s for s in get_meta(cx, key, [])}
    for res in results:
        prev = saved.get(res["name"], {})
        res["last_ok"] = res["at"] if res["ok"] else prev.get("last_ok")
        saved[res["name"]] = res
    set_meta(cx, key, list(saved.values()))
    return list(saved.values())


def _run(name: str, fn, sink: list, results: list):
    at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    try:
        items = fn()
        sink += items
        results.append({"name": name, "ok": True, "count": len(items), "note": "", "at": at})
        return True
    except Exception as exc:  # noqa: BLE001
        note = _short(f"{type(exc).__name__}: {exc}", 140)
        results.append({"name": name, "ok": False, "count": 0, "note": note, "at": at})
        print(f"[events] {name} failed: {note}")
        return False


def refresh(cx, market: str, tracked: list[str], names: dict | None = None) -> list[dict]:
    """Market-wide refresh, run by the scheduled news/full jobs."""
    today = date.today()
    items, results = [], []
    if market == "IN":
        client = _NSE()
        _run("NSE filings", lambda: [e for part in nse_window(
            today - timedelta(EXPORT_BACK), today + timedelta(60), client)
            for e in part], items, results)
    else:
        watch = {s.upper() for s in tracked}
        _run("Nasdaq earnings", lambda: nasdaq_earnings(
            today - timedelta(7), today + timedelta(35), watch), items, results)
        _run("Nasdaq dividends", lambda: nasdaq_dividends(
            today, today + timedelta(21), watch), items, results)
    _run("Yahoo Finance", lambda: yahoo_calendar(tracked, market, names), items, results)
    save_corp_events(cx, items)
    return _record(cx, market, results)


def refresh_symbols(cx, market: str, symbols: list[str], names: dict | None = None) -> list[dict]:
    """Targeted refresh for a few tickers (a just-added watchlist symbol)."""
    items, results = [], []
    if market == "IN":
        client = _NSE()
        cutoff = _iso(date.today() - timedelta(EXPORT_BACK))
        _run("NSE filings", lambda: [e for s in symbols for e in nse_symbol(s, client)
                                     if e["date"] >= cutoff], items, results)
    _run("Yahoo Finance", lambda: yahoo_calendar(symbols, market, names), items, results)
    save_corp_events(cx, items)
    # Only failures are worth surfacing from a targeted run; a partial success
    # must not overwrite the market-wide counts.
    return _record(cx, market, [r for r in results if not r["ok"]])


def _supersedes(official: dict, est: dict) -> bool:
    gap = abs((date.fromisoformat(official["date"]) - date.fromisoformat(est["date"])).days)
    overlap = set(official["types"]) & set(est["types"]) or (
        "results" in est["types"] and "board_meeting" in official["types"])
    return bool(overlap) and gap <= (10 if "results" in est["types"] else 5)


def export(cx, market: str, path: Path) -> dict:
    today = date.today()
    start, end = today - timedelta(EXPORT_BACK), today + timedelta(EXPORT_AHEAD)
    items = corp_events_between(cx, market, _iso(start), _iso(end))
    official = {}
    for e in items:
        if e.get("official"):
            official.setdefault(e["symbol"], []).append(e)
    keep = []
    for e in items:
        e.pop("first_seen", None)
        e.pop("market", None)
        if not e.get("official") and any(_supersedes(o, e) for o in official.get(e["symbol"], [])):
            continue
        keep.append(e)
    payload = {"market": market,
               "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
               "window": {"from": _iso(start), "to": _iso(end)},
               "sources": get_meta(cx, f"events_sources:{market}", []),
               "items": keep}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, separators=(",", ":"), default=str))
    return payload
