#!/usr/bin/env python
"""Build the static weekly equity-macro cache for the frontend.

Security posture:
- Runs only as a backend/local/CI script.
- Reads secrets from environment variables only; never writes them to output.
- Stores derived weekly data, not raw tick or session data.
- Preserves the existing last-known-good JSON when a critical fetch fails.
"""

from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Callable

import pandas as pd

APP_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = APP_ROOT / "public" / "data" / "equity-weekly.json"

START_DATE = pd.Timestamp(os.environ.get("EQUITY_MACRO_START_DATE", "2025-01-20"))
PRICE_SOURCE = os.environ.get("EQUITY_PRICE_SOURCE", "akshare").strip().lower()
ASSETS = {
    "QQQ": {"symbol": "QQQ", "name": "Invesco QQQ Trust", "role": "Nasdaq 100 proxy"},
    "SPY": {"symbol": "SPY", "name": "SPDR S&P 500 ETF Trust", "role": "S&P 500 proxy"},
}
FRED_SERIES = {
    "DGS10": {"label": "10Y Treasury", "unit": "%", "kind": "yield"},
    "VIXCLS": {"label": "VIX", "unit": "index", "kind": "volatility"},
    "DFF": {"label": "Effective Fed Funds", "unit": "%", "kind": "policy_rate"},
}


@dataclass
class DailyPrices:
    symbol: str
    source: str
    frame: pd.DataFrame


def iso_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def read_existing() -> dict | None:
    try:
        return json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except json.JSONDecodeError:
        return None


def finite_number(value) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if pd.isna(number):
        return None
    return number


def pct_change(open_value: float | None, close_value: float | None) -> float | None:
    if open_value is None or close_value is None or open_value == 0:
        return None
    return ((close_value - open_value) / open_value) * 100


def source_akshare_daily(symbol: str) -> DailyPrices:
    import akshare as ak

    frame = ak.stock_us_daily(symbol=symbol, adjust="")
    if frame.empty:
        raise RuntimeError(f"AKShare returned no rows for {symbol}")
    frame = frame.rename(columns={column: column.lower() for column in frame.columns})
    frame["date"] = pd.to_datetime(frame["date"], errors="coerce")
    frame = frame.dropna(subset=["date"])
    frame = frame.set_index("date").sort_index()
    required = ["open", "high", "low", "close", "volume"]
    for column in required:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    frame = frame[required].dropna(subset=["open", "high", "low", "close"])
    return DailyPrices(symbol=symbol, source="AKShare / Sina US stock daily (unadjusted)", frame=frame)


def source_yfinance_daily(symbol: str) -> DailyPrices:
    import yfinance as yf

    cache_dir = APP_ROOT.parent / "tmp" / "yfinance-cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    if hasattr(yf, "set_tz_cache_location"):
      yf.set_tz_cache_location(str(cache_dir))
    frame = yf.download(
        symbol,
        start=START_DATE.strftime("%Y-%m-%d"),
        interval="1d",
        auto_adjust=False,
        progress=False,
        threads=False,
        timeout=20,
    )
    if frame.empty:
        raise RuntimeError(f"yfinance returned no rows for {symbol}")
    if isinstance(frame.columns, pd.MultiIndex):
        frame.columns = [str(col[0]).lower().replace(" ", "_") for col in frame.columns]
    else:
        frame.columns = [str(col).lower().replace(" ", "_") for col in frame.columns]
    rename = {
        "adj_close": "adj_close",
        "open": "open",
        "high": "high",
        "low": "low",
        "close": "close",
        "volume": "volume",
    }
    frame = frame.rename(columns=rename)
    for column in ["open", "high", "low", "close", "volume"]:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    frame.index = pd.to_datetime(frame.index).tz_localize(None)
    frame = frame[["open", "high", "low", "close", "volume"]].dropna(subset=["open", "high", "low", "close"])
    return DailyPrices(symbol=symbol, source="yfinance daily (unadjusted close)", frame=frame)


def fetch_daily_prices(symbol: str, failures: list[str]) -> DailyPrices:
    providers: dict[str, Callable[[str], DailyPrices]] = {
        "akshare": source_akshare_daily,
        "yfinance": source_yfinance_daily,
    }
    ordered = [PRICE_SOURCE] + [name for name in providers if name != PRICE_SOURCE]
    last_error: Exception | None = None
    for provider_name in ordered:
        provider = providers.get(provider_name)
        if provider is None:
            continue
        try:
            result = provider(symbol)
            result.frame = result.frame[result.frame.index >= START_DATE]
            if result.frame.empty:
                raise RuntimeError(f"{provider_name} has no rows after {START_DATE.date()}")
            return result
        except Exception as exc:  # noqa: BLE001 - provider failures are converted to cache provenance.
            last_error = exc
            failures.append(f"{symbol} {provider_name}: {exc}")
    raise RuntimeError(f"No price source produced data for {symbol}: {last_error}")


def weekly_prices(daily: DailyPrices) -> pd.DataFrame:
    grouped = daily.frame.groupby(pd.Grouper(freq="W-FRI"))
    rows = []
    for week_end, group in grouped:
        group = group.dropna(subset=["open", "high", "low", "close"])
        if group.empty:
            continue
        first = group.iloc[0]
        last = group.iloc[-1]
        open_value = finite_number(first["open"])
        close_value = finite_number(last["close"])
        rows.append({
            "weekEnd": week_end.strftime("%Y-%m-%d"),
            "tradingStart": group.index[0].strftime("%Y-%m-%d"),
            "tradingEnd": group.index[-1].strftime("%Y-%m-%d"),
            "open": open_value,
            "high": finite_number(group["high"].max()),
            "low": finite_number(group["low"].min()),
            "close": close_value,
            "volume": finite_number(group["volume"].sum()),
            "pct": pct_change(open_value, close_value),
        })
    return pd.DataFrame(rows).set_index("weekEnd")


def fetch_fred_series(failures: list[str]) -> dict[str, pd.Series]:
    from fredapi import Fred

    fred = Fred()
    output: dict[str, pd.Series] = {}
    for series_id in FRED_SERIES:
        try:
            series = fred.get_series(series_id, observation_start=START_DATE.strftime("%Y-%m-%d"))
            series.index = pd.to_datetime(series.index)
            series = pd.to_numeric(series, errors="coerce").dropna()
            output[series_id] = series
        except Exception as exc:  # noqa: BLE001
            failures.append(f"FRED {series_id}: {exc}")
    return output


def weekly_macro(series: pd.Series) -> pd.DataFrame:
    grouped = series.groupby(pd.Grouper(freq="W-FRI"))
    rows = []
    for week_end, group in grouped:
        group = group.dropna()
        if group.empty:
            continue
        start_value = finite_number(group.iloc[0])
        end_value = finite_number(group.iloc[-1])
        rows.append({
            "weekEnd": week_end.strftime("%Y-%m-%d"),
            "start": start_value,
            "end": end_value,
            "change": None if start_value is None or end_value is None else end_value - start_value,
            "changeBp": None if start_value is None or end_value is None else (end_value - start_value) * 100,
            "observationStart": group.index[0].strftime("%Y-%m-%d"),
            "observationEnd": group.index[-1].strftime("%Y-%m-%d"),
        })
    return pd.DataFrame(rows).set_index("weekEnd")


def week_start_from_end(week_end: str) -> str:
    return (pd.Timestamp(week_end) - timedelta(days=6)).strftime("%Y-%m-%d")


def build_output() -> dict:
    failures: list[str] = []
    price_daily = {symbol: fetch_daily_prices(symbol, failures) for symbol in ASSETS}
    price_weekly = {symbol: weekly_prices(prices) for symbol, prices in price_daily.items()}
    macro_daily = fetch_fred_series(failures)
    macro_weekly = {series_id: weekly_macro(series) for series_id, series in macro_daily.items()}

    week_keys = sorted(set().union(*(set(frame.index) for frame in price_weekly.values())))
    weeks = []
    for week_end in week_keys:
        qqq = price_weekly["QQQ"].loc[week_end].to_dict() if week_end in price_weekly["QQQ"].index else None
        spy = price_weekly["SPY"].loc[week_end].to_dict() if week_end in price_weekly["SPY"].index else None
        qqq_pct = finite_number(qqq.get("pct")) if qqq else None
        spy_pct = finite_number(spy.get("pct")) if spy else None
        relative_pct = None if qqq_pct is None or spy_pct is None else qqq_pct - spy_pct
        macro = {}
        for series_id, frame in macro_weekly.items():
            if week_end in frame.index:
                macro[series_id] = frame.loc[week_end].to_dict()
        weeks.append({
            "weekKey": week_end,
            "weekStart": week_start_from_end(week_end),
            "weekEnd": week_end,
            "assets": {
                "QQQ": qqq,
                "SPY": spy,
            },
            "relativePct": relative_pct,
            "leader": None if qqq_pct is None or spy_pct is None else ("QQQ" if qqq_pct >= spy_pct else "SPY"),
            "macro": macro,
            "events": [],
        })

    if not weeks:
        raise RuntimeError("No weekly rows produced")

    return {
        "version": 1,
        "page": "equity-macro",
        "timezone": "America/New_York for trading dates; FRED observations use provider dates",
        "generatedAt": iso_now(),
        "startDate": START_DATE.strftime("%Y-%m-%d"),
        "methodology": (
            "Weekly price rows are derived from daily OHLC and grouped by Friday week-end. "
            "QQQ minus SPY is shown in percentage points. Event fields are intentionally empty in the MVP."
        ),
        "priceSourcePreference": PRICE_SOURCE,
        "failures": failures,
        "assets": {
            symbol: {
                **ASSETS[symbol],
                "sourceLabel": price_daily[symbol].source,
                "rows": len(price_daily[symbol].frame),
                "firstDate": price_daily[symbol].frame.index[0].strftime("%Y-%m-%d"),
                "lastDate": price_daily[symbol].frame.index[-1].strftime("%Y-%m-%d"),
            }
            for symbol in ASSETS
        },
        "macroSeries": FRED_SERIES,
        "sources": {
            "QQQ": "AKShare/Sina US daily by default; yfinance supported via EQUITY_PRICE_SOURCE=yfinance",
            "SPY": "AKShare/Sina US daily by default; yfinance supported via EQUITY_PRICE_SOURCE=yfinance",
            "FRED": "https://fred.stlouisfed.org/docs/api/fred/",
            "events": "Reserved for curated future event annotations; no external event source enabled",
        },
        "weeks": weeks,
    }


def main() -> int:
    existing = read_existing()
    try:
        output = build_output()
    except Exception as exc:  # noqa: BLE001
        if existing:
            print(json.dumps({
                "status": "kept-last-known-good",
                "outputPath": str(OUTPUT_PATH),
                "error": str(exc),
            }, ensure_ascii=False))
            return 0
        raise

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "status": "updated",
        "outputPath": str(OUTPUT_PATH),
        "weeks": len(output["weeks"]),
        "failures": output["failures"],
        "lastWeek": output["weeks"][-1]["weekKey"],
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
