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
    scored_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_news_symbol_pub ON news(symbol, published);

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


@contextmanager
def conn():
    cx = sqlite3.connect(DB_PATH)
    cx.row_factory = sqlite3.Row
    try:
        cx.executescript(SCHEMA)
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


def save_news(cx, items: list[dict]) -> int:
    before = cx.execute("SELECT COUNT(*) FROM news").fetchone()[0]
    cx.executemany(
        "INSERT OR IGNORE INTO news"
        "(id,symbol,market,published,title,link,source,summary,sentiment,sentiment_label,scored_by)"
        " VALUES (:id,:symbol,:market,:published,:title,:link,:source,:summary,"
        ":sentiment,:sentiment_label,:scored_by)",
        items,
    )
    return cx.execute("SELECT COUNT(*) FROM news").fetchone()[0] - before


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


def prune(cx, keep_news_days: int = 120, keep_alerts: int = 2000) -> None:
    """Keep the committed DB small enough that git history stays sane."""
    cx.execute(
        "DELETE FROM news WHERE published < datetime('now', ?)",
        (f"-{keep_news_days} days",),
    )
    cx.execute(
        "DELETE FROM alerts WHERE id NOT IN "
        "(SELECT id FROM alerts ORDER BY id DESC LIMIT ?)",
        (keep_alerts,),
    )
