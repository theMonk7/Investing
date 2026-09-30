"""Hand-rolled indicators.

Deliberately no pandas-ta / TA-Lib: both are fragile to install in CI
(numpy 2 breakage, C toolchain). These are ~40 lines of pandas and are
exactly reproducible, which matters because the model trains on them.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def sma(s: pd.Series, n: int) -> pd.Series:
    return s.rolling(n, min_periods=max(2, n // 2)).mean()


def ema(s: pd.Series, n: int) -> pd.Series:
    return s.ewm(span=n, adjust=False, min_periods=max(2, n // 2)).mean()


def rsi(close: pd.Series, n: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    avg_loss = loss.ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    return (100 - 100 / (1 + rs)).fillna(50)


def macd(close: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9):
    line = ema(close, fast) - ema(close, slow)
    sig = ema(line, signal)
    return line, sig, line - sig


def atr(df: pd.DataFrame, n: int = 14) -> pd.Series:
    prev_close = df["close"].shift()
    tr = pd.concat([
        df["high"] - df["low"],
        (df["high"] - prev_close).abs(),
        (df["low"] - prev_close).abs(),
    ], axis=1).max(axis=1)
    return tr.ewm(alpha=1 / n, adjust=False, min_periods=n).mean()


def bollinger(close: pd.Series, n: int = 20, k: float = 2.0):
    mid = sma(close, n)
    sd = close.rolling(n, min_periods=max(2, n // 2)).std()
    return mid - k * sd, mid, mid + k * sd


def obv(df: pd.DataFrame) -> pd.Series:
    direction = np.sign(df["close"].diff()).fillna(0)
    return (direction * df["volume"]).cumsum()


def zscore(s: pd.Series, n: int = 20) -> pd.Series:
    mean = s.rolling(n, min_periods=max(2, n // 2)).mean()
    sd = s.rolling(n, min_periods=max(2, n // 2)).std()
    return ((s - mean) / sd.replace(0, np.nan)).fillna(0)


def enrich(df: pd.DataFrame) -> pd.DataFrame:
    """Attach every indicator the rest of the pipeline consumes.

    `df` must be indexed by date with columns open/high/low/close/volume.
    """
    out = df.copy()
    c = out["close"]

    out["ret_1d"] = c.pct_change()
    for n in (5, 10, 20, 60):
        out[f"ret_{n}d"] = c.pct_change(n)

    out["sma20"] = sma(c, 20)
    out["sma50"] = sma(c, 50)
    out["sma200"] = sma(c, 200)
    out["ema12"] = ema(c, 12)
    out["dist_sma50"] = c / out["sma50"] - 1
    out["dist_sma200"] = c / out["sma200"] - 1

    out["rsi14"] = rsi(c, 14)
    line, sig, hist = macd(c)
    out["macd"], out["macd_signal"], out["macd_hist"] = line, sig, hist

    out["atr14"] = atr(out, 14)
    out["atr_pct"] = out["atr14"] / c

    lo, mid, hi = bollinger(c)
    out["bb_low"], out["bb_mid"], out["bb_high"] = lo, mid, hi
    width = (hi - lo).replace(0, np.nan)
    out["bb_pctb"] = ((c - lo) / width).clip(-1, 2)
    out["bb_width"] = width / mid

    out["vol_sma20"] = sma(out["volume"], 20)
    out["vol_z"] = zscore(out["volume"], 20)
    out["obv"] = obv(out)
    out["obv_slope"] = out["obv"].diff(10) / out["volume"].rolling(10).mean().replace(0, np.nan)

    out["vol_20d"] = out["ret_1d"].rolling(20, min_periods=10).std() * np.sqrt(252)
    out["hi_52w"] = out["high"].rolling(252, min_periods=60).max()
    out["lo_52w"] = out["low"].rolling(252, min_periods=60).min()
    out["pct_from_52w_hi"] = c / out["hi_52w"] - 1
    out["pct_from_52w_lo"] = c / out["lo_52w"] - 1

    out["gap_pct"] = out["open"] / c.shift() - 1
    return out


def trend_label(row) -> str:
    """Plain-English regime label used by the UI and the teaching engine."""
    c, s50, s200 = row.get("close"), row.get("sma50"), row.get("sma200")
    if pd.isna(s50) or pd.isna(s200):
        return "Insufficient history"
    if c > s50 > s200:
        return "Strong uptrend"
    if c > s200 and c <= s50:
        return "Uptrend, pulling back"
    if c < s50 < s200:
        return "Strong downtrend"
    if c < s200 and c >= s50:
        return "Downtrend, bouncing"
    return "Sideways / chop"


def support_resistance(df: pd.DataFrame, lookback: int = 120, n: int = 3):
    """Cheap pivot clustering -- good enough to draw levels, honest about it."""
    win = df.tail(lookback)
    if len(win) < 20:
        return [], []
    highs = win["high"].nlargest(n * 4).round(2)
    lows = win["low"].nsmallest(n * 4).round(2)
    last = float(win["close"].iloc[-1])
    res = sorted({float(x) for x in highs if x > last})[:n]
    sup = sorted({float(x) for x in lows if x < last}, reverse=True)[:n]
    return sup, res
