"""SQLite persistence.

The DB is the source of truth and is committed back to the repo by the
workflow, so history survives across runs without any hosted database.
The UI never reads SQLite directly -- run_all.py exports JSON snapshots.
"""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone

from config import DB_PATH

SCHEMA = """
CREATE TABLE IF NOT EXISTS prices (
    symbol TEXT NOT NULL,
    date   TEXT NOT NULL,
    open REAL, high REAL, low REAL, close REAL, volume REAL,
    PRIMARY KEY (symbol, date)
);

CREATE TABLE IF NOT EXISTS quotes (
    symbol TEXT PRIMARY KEY,
    market TEXT,
    ts TEXT,
    payload TEXT
);

CREATE TABLE IF NOT EXISTS news (
    id TEXT PRIMARY KEY,
    symbol TEXT,
    market TEXT,
    published TEXT,
    title TEXT,
    link TEXT,
    source TEXT,
    summary TEXT,
    sentiment REAL,
    sentiment_label TEXT,
    scored_by TEXT,
    -- when OUR pipeline first saw it; drives the "new since your last visit"
    -- badge, because `published` is the outlet's clock, not ours
    first_seen TEXT,
    sector TEXT,
    event_type TEXT,
    tickers TEXT,            -- JSON array of matched symbols
    corroboration INTEGER DEFAULT 1,   -- how many outlets carried the story
    kind TEXT DEFAULT 'news'           -- news | filing | disclosure
);
CREATE INDEX IF NOT EXISTS idx_news_symbol_pub ON news(symbol, published);

-- Daily per-sector rollup, kept so the sector charts have real history
-- instead of only what the current news window happens to contain.
CREATE TABLE IF NOT EXISTS sector_daily (
    market TEXT NOT NULL,
    sector TEXT NOT NULL,
    date   TEXT NOT NULL,
    sentiment REAL,
    story_count INTEGER,
    bullish INTEGER, bearish INTEGER, neutral INTEGER,
    ret_1d REAL, ret_5d REAL,
    PRIMARY KEY (market, sector, date)
);

-- Observed price reaction after an event type, accumulated over time.
CREATE TABLE IF NOT EXISTS event_log (
    id TEXT PRIMARY KEY,
    symbol TEXT, market TEXT, event_type TEXT,
    date TEXT, sentiment REAL, headline TEXT,
    ret_1d REAL, ret_3d REAL, ret_5d REAL, graded INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_event_type ON event_log(event_type, graded);

CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT, symbol TEXT, market TEXT, kind TEXT,
    severity TEXT, title TEXT, body TEXT, delivered INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_alerts_sym_kind ON alerts(symbol, kind, ts);

CREATE TABLE IF NOT EXISTS predictions (
    symbol TEXT NOT NULL,
    asof TEXT NOT NULL,
    horizon_days INTEGER,
    prob_up REAL,
    expected_move REAL,
    confidence TEXT,
    drivers TEXT,
    PRIMARY KEY (symbol, asof)
);

CREATE TABLE IF NOT EXISTS lessons_seen (
    lesson_id TEXT PRIMARY KEY,
    ts TEXT
);

CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
"""


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# Columns added after the first release. CREATE TABLE IF NOT EXISTS will not
# add them to an existing table, and the DB is committed to the repo, so it
# survives upgrades and has to be migrated in place.
_ADDED_COLUMNS = {
    "news": [
        ("first_seen", "TEXT"), ("sector", "TEXT"), ("event_type", "TEXT"),
        ("tickers", "TEXT"), ("corroboration", "INTEGER DEFAULT 1"),
        ("kind", "TEXT DEFAULT 'news'"),
    ],
}


# Indexes over columns that _migrate may still need to add. They cannot live
# in SCHEMA: executescript runs before the migration, and CREATE INDEX on a
# not-yet-added column fails the whole script.
POST_MIGRATION_INDEXES = """
CREATE INDEX IF NOT EXISTS idx_news_first_seen ON news(first_seen);
CREATE INDEX IF NOT EXISTS idx_news_sector ON news(sector, published);
CREATE INDEX IF NOT EXISTS idx_news_kind ON news(kind, published);
"""


def _migrate(cx) -> None:
    for table, columns in _ADDED_COLUMNS.items():
        existing = {r["name"] for r in cx.execute(f"PRAGMA table_info({table})")}
        for name, decl in columns:
            if name not in existing:
                cx.execute(f"ALTER TABLE {table} ADD COLUMN {name} {decl}")
    # Backfill first_seen for rows that predate the column.
    cx.execute("UPDATE news SET first_seen=published WHERE first_seen IS NULL")
    cx.executescript(POST_MIGRATION_INDEXES)


@contextmanager
def conn():
    cx = sqlite3.connect(DB_PATH)
    cx.row_factory = sqlite3.Row
    try:
        cx.executescript(SCHEMA)
        _migrate(cx)
        yield cx
        cx.commit()
    finally:
        cx.close()


def upsert_prices(cx, symbol: str, rows) -> None:
    cx.executemany(
        "INSERT OR REPLACE INTO prices(symbol,date,open,high,low,close,volume)"
        " VALUES (?,?,?,?,?,?,?)",
        [(symbol, d, o, h, l, c, v) for d, o, h, l, c, v in rows],
    )


def save_quote(cx, symbol: str, market: str, payload: dict) -> None:
    cx.execute(
        "INSERT OR REPLACE INTO quotes(symbol,market,ts,payload) VALUES (?,?,?,?)",
        (symbol, market, utcnow(), json.dumps(payload)),
    )


NEWS_FIELDS = ("id", "symbol", "market", "published", "title", "link", "source",
               "summary", "sentiment", "sentiment_label", "scored_by",
               "first_seen", "sector", "event_type", "tickers",
               "corroboration", "kind")


def save_news(cx, items: list[dict]) -> int:
    """Insert-or-ignore, so `first_seen` is preserved across runs.

    A story already in the table keeps its original first_seen -- that is what
    makes the feed additive rather than a rolling replacement. Only the
    corroboration count and sentiment are allowed to move.
    """
    if not items:
        return 0
    now = utcnow()
    rows = []
    for it in items:
        row = {k: it.get(k) for k in NEWS_FIELDS}
        row["first_seen"] = row["first_seen"] or now
        row["corroboration"] = row["corroboration"] or 1
        row["kind"] = row["kind"] or "news"
        if isinstance(row["tickers"], (list, tuple)):
            row["tickers"] = json.dumps(list(row["tickers"]))
        rows.append(row)

    before = cx.execute("SELECT COUNT(*) FROM news").fetchone()[0]
    cx.executemany(
        f"INSERT OR IGNORE INTO news({','.join(NEWS_FIELDS)})"
        f" VALUES ({','.join(':' + f for f in NEWS_FIELDS)})",
        rows,
    )
    # Refresh the fields that legitimately change on a re-sighting.
    cx.executemany(
        "UPDATE news SET corroboration=MAX(corroboration, :corroboration),"
        " sentiment=:sentiment, sentiment_label=:sentiment_label,"
        " scored_by=:scored_by, event_type=COALESCE(:event_type, event_type),"
        " sector=COALESCE(:sector, sector) WHERE id=:id",
        rows,
    )
    return cx.execute("SELECT COUNT(*) FROM news").fetchone()[0] - before


def recent_news(cx, market: str, limit: int = 400, kind: str | None = None) -> list[dict]:
    """The accumulating feed, newest-first by when WE first saw it."""
    sql = ("SELECT id,symbol,market,published,first_seen,title,link,source,summary,"
           "sentiment,sentiment_label,scored_by,sector,event_type,tickers,"
           "corroboration,kind FROM news WHERE market IN (?, 'GLOBAL')")
    params: list = [market]
    if kind:
        sql += " AND kind=?"
        params.append(kind)
    sql += " ORDER BY first_seen DESC, published DESC LIMIT ?"
    params.append(limit)
    out = []
    for row in cx.execute(sql, params).fetchall():
        item = dict(row)
        try:
            item["tickers"] = json.loads(item["tickers"] or "[]")
        except (TypeError, json.JSONDecodeError):
            item["tickers"] = []
        out.append(item)
    return out


def save_sector_daily(cx, market: str, rows: list[dict]) -> None:
    cx.executemany(
        "INSERT OR REPLACE INTO sector_daily"
        "(market,sector,date,sentiment,story_count,bullish,bearish,neutral,ret_1d,ret_5d)"
        " VALUES (:market,:sector,:date,:sentiment,:story_count,:bullish,:bearish,"
        ":neutral,:ret_1d,:ret_5d)",
        [{**r, "market": market} for r in rows],
    )


def sector_history(cx, market: str, days: int = 30) -> list[dict]:
    return [dict(r) for r in cx.execute(
        "SELECT sector,date,sentiment,story_count,bullish,bearish,neutral,ret_1d,ret_5d"
        " FROM sector_daily WHERE market=? AND date >= date('now', ?)"
        " ORDER BY date",
        (market, f"-{days} days"),
    ).fetchall()]


def log_events(cx, rows: list[dict]) -> None:
    if not rows:
        return
    cx.executemany(
        "INSERT OR IGNORE INTO event_log"
        "(id,symbol,market,event_type,date,sentiment,headline)"
        " VALUES (:id,:symbol,:market,:event_type,:date,:sentiment,:headline)",
        rows,
    )


def save_prediction(cx, symbol: str, asof: str, horizon: int, prob_up: float,
                    expected_move: float, confidence: str, drivers: list) -> None:
    cx.execute(
        "INSERT OR REPLACE INTO predictions"
        "(symbol,asof,horizon_days,prob_up,expected_move,confidence,drivers)"
        " VALUES (?,?,?,?,?,?,?)",
        (symbol, asof, horizon, prob_up, expected_move, confidence, json.dumps(drivers)),
    )


def record_alert(cx, symbol: str, market: str, kind: str, severity: str,
                 title: str, body: str) -> int:
    cur = cx.execute(
        "INSERT INTO alerts(ts,symbol,market,kind,severity,title,body)"
        " VALUES (?,?,?,?,?,?,?)",
        (utcnow(), symbol, market, kind, severity, title, body),
    )
    return cur.lastrowid


def mark_delivered(cx, alert_ids: list[int]) -> None:
    cx.executemany("UPDATE alerts SET delivered=1 WHERE id=?", [(i,) for i in alert_ids])


def last_alert_ts(cx, symbol: str, kind: str) -> str | None:
    row = cx.execute(
        "SELECT ts FROM alerts WHERE symbol=? AND kind=? ORDER BY ts DESC LIMIT 1",
        (symbol, kind),
    ).fetchone()
    return row["ts"] if row else None


def set_meta(cx, key: str, value) -> None:
    cx.execute("INSERT OR REPLACE INTO meta(k,v) VALUES (?,?)",
               (key, json.dumps(value)))


def get_meta(cx, key: str, default=None):
    row = cx.execute("SELECT v FROM meta WHERE k=?", (key,)).fetchone()
    return json.loads(row["v"]) if row else default


def prune(cx, keep_news_days: int = 180, keep_alerts: int = 2000) -> None:
    """Keep the committed DB small enough that git history stays sane."""
    cx.execute(
        "DELETE FROM news WHERE COALESCE(first_seen, published) < datetime('now', ?)",
        (f"-{keep_news_days} days",),
    )
    cx.execute("DELETE FROM sector_daily WHERE date < date('now', '-365 days')")
    cx.execute("DELETE FROM event_log WHERE date < date('now', '-365 days')")
    cx.execute(
        "DELETE FROM alerts WHERE id NOT IN "
        "(SELECT id FROM alerts ORDER BY id DESC LIMIT ?)",
        (keep_alerts,),
    )
