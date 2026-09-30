"""Price ingestion via yfinance (free, no API key, covers NSE + US)."""
from __future__ import annotations

import time

import pandas as pd
import yfinance as yf

from config import HISTORY_PERIOD
from technicals import enrich

_CACHE: dict[str, pd.DataFrame] = {}


def _normalise(raw: pd.DataFrame) -> pd.DataFrame:
    if raw is None or raw.empty:
        return pd.DataFrame()
    df = raw.rename(columns=str.lower)
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    keep = ["open", "high", "low", "close", "volume"]
    missing = [c for c in keep if c not in df.columns]
    if missing:
        return pd.DataFrame()
    df = df[keep].dropna(subset=["close"])
    df.index = pd.to_datetime(df.index).tz_localize(None).normalize()
    return df[~df.index.duplicated(keep="last")].sort_index()


def download_history(symbols: list[str], period: str = HISTORY_PERIOD,
                     chunk: int = 25) -> dict[str, pd.DataFrame]:
    """Batch download; yfinance rate-limits hard above ~50 symbols per call."""
    out: dict[str, pd.DataFrame] = {}
    for i in range(0, len(symbols), chunk):
        batch = symbols[i:i + chunk]
        try:
            raw = yf.download(
                batch, period=period, interval="1d", group_by="ticker",
                auto_adjust=True, threads=True, progress=False,
            )
        except Exception as exc:  # noqa: BLE001 - one bad batch must not kill the run
            print(f"[prices] batch failed {batch[:3]}...: {exc}")
            continue

        for sym in batch:
            try:
                sub = raw[sym] if isinstance(raw.columns, pd.MultiIndex) else raw
            except KeyError:
                continue
            norm = _normalise(sub)
            if len(norm) >= 60:
                out[sym] = norm
        if i + chunk < len(symbols):
            time.sleep(1.0)
    return out


def history(symbol: str, period: str = HISTORY_PERIOD) -> pd.DataFrame:
    if symbol in _CACHE:
        return _CACHE[symbol]
    try:
        raw = yf.Ticker(symbol).history(period=period, interval="1d", auto_adjust=True)
    except Exception as exc:  # noqa: BLE001
        print(f"[prices] {symbol} failed: {exc}")
        return pd.DataFrame()
    df = _normalise(raw)
    _CACHE[symbol] = df
    return df


def quote_from(symbol: str, df: pd.DataFrame, meta: dict | None = None) -> dict:
    """Collapse an enriched frame into the flat record the UI renders."""
    if df.empty:
        return {}
    e = enrich(df)
    last, prev = e.iloc[-1], (e.iloc[-2] if len(e) > 1 else e.iloc[-1])
    close = float(last["close"])
    prev_close = float(prev["close"])
    change = close - prev_close
    meta = meta or {}

    def f(key, default=None):
        val = last.get(key)
        return None if val is None or pd.isna(val) else float(val)

    return {
        "symbol": symbol,
        "name": meta.get("name", symbol),
        "date": last.name.strftime("%Y-%m-%d"),
        "close": round(close, 2),
        "prev_close": round(prev_close, 2),
        "change": round(change, 2),
        "change_pct": round(change / prev_close * 100, 2) if prev_close else 0.0,
        "open": round(float(last["open"]), 2),
        "high": round(float(last["high"]), 2),
        "low": round(float(last["low"]), 2),
        "volume": int(last["volume"]) if not pd.isna(last["volume"]) else 0,
        "rsi14": round(f("rsi14") or 50, 1),
        "macd_hist": round(f("macd_hist") or 0, 4),
        "sma20": round(f("sma20") or close, 2),
        "sma50": round(f("sma50") or close, 2),
        "sma200": round(f("sma200") or close, 2),
        "atr_pct": round((f("atr_pct") or 0) * 100, 2),
        "vol_z": round(f("vol_z") or 0, 2),
        "bb_pctb": round(f("bb_pctb") or 0.5, 2),
        "vol_20d": round((f("vol_20d") or 0) * 100, 1),
        "ret_5d": round((f("ret_5d") or 0) * 100, 2),
        "ret_20d": round((f("ret_20d") or 0) * 100, 2),
        "ret_60d": round((f("ret_60d") or 0) * 100, 2),
        "pct_from_52w_hi": round((f("pct_from_52w_hi") or 0) * 100, 2),
        "pct_from_52w_lo": round((f("pct_from_52w_lo") or 0) * 100, 2),
        "hi_52w": round(f("hi_52w") or close, 2),
        "lo_52w": round(f("lo_52w") or close, 2),
        "gap_pct": round((f("gap_pct") or 0) * 100, 2),
    }


def ohlc_series(df: pd.DataFrame, days: int = 260) -> list[dict]:
    """Candles for lightweight-charts, plus the overlays it draws."""
    e = enrich(df).tail(days)
    rows = []
    for ts, r in e.iterrows():
        rows.append({
            "time": ts.strftime("%Y-%m-%d"),
            "open": round(float(r["open"]), 2),
            "high": round(float(r["high"]), 2),
            "low": round(float(r["low"]), 2),
            "close": round(float(r["close"]), 2),
            "volume": int(r["volume"]) if not pd.isna(r["volume"]) else 0,
            "sma20": None if pd.isna(r["sma20"]) else round(float(r["sma20"]), 2),
            "sma50": None if pd.isna(r["sma50"]) else round(float(r["sma50"]), 2),
            "rsi14": None if pd.isna(r["rsi14"]) else round(float(r["rsi14"]), 1),
        })
    return rows


def fetch_names(symbols: list[str]) -> dict[str, str]:
    """Company names are cosmetic -- never let a lookup failure block a run."""
    names = {}
    for sym in symbols:
        try:
            info = yf.Ticker(sym).get_info()
            names[sym] = info.get("shortName") or info.get("longName") or sym
        except Exception:  # noqa: BLE001
            names[sym] = sym
    return names
