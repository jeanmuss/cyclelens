#!/usr/bin/env python
"""Build the static daily equity-macro calendar cache for the frontend.

Security posture:
- Runs only as a backend/local/CI script.
- Reads provider credentials from environment variables only; never writes them to output.
- Stores a six-month derived daily calendar plus minimal local provider caches.
- Preserves the existing last-known-good JSON when a critical fetch fails.
"""

from __future__ import annotations

import json
import os
import csv
import sys
from io import StringIO
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd
import requests

from data_use_scope import (
    cache_root_for_scope,
    data_directory_for_scope,
    data_use_scope_from_environment,
    source_is_eligible,
)
from secure_http import get_json_bounded

APP_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = APP_ROOT.parent
DATA_USE_SCOPE = data_use_scope_from_environment(os.environ, sys.argv[1:])
DATA_DIRECTORY = data_directory_for_scope(APP_ROOT, DATA_USE_SCOPE)
OUTPUT_PATH = DATA_DIRECTORY / "equity-weekly.json"
RECURRING_EVENTS_PATH = APP_ROOT / "data" / "equity-recurring-events.json"
CACHE_ROOT = cache_root_for_scope(WORKSPACE_ROOT, DATA_USE_SCOPE)
CACHE_DIR = CACHE_ROOT / "equity-cache"
SHARED_FRED_CACHE_DIR = CACHE_ROOT / "macro-cache" / "fred"
MOF_JGB10Y_CACHE_PATH = CACHE_DIR / "mof-JGB10Y.json"
MOF_JGB_CURRENT_URL = "https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/jgbcme.csv"
MOF_JGB_HISTORY_URL = "https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/historical/jgbcme_all.csv"
MOF_JGB_METHODOLOGY_URL = "https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/qa.htm"
ALPACA_DATA_ORIGIN = "https://data.alpaca.markets"
FRED_OBSERVATIONS_URL = "https://api.stlouisfed.org/fred/series/observations"
FRED_ALLOWED_ORIGINS = frozenset({"https://api.stlouisfed.org"})
MAX_ALPACA_RESPONSE_BYTES = 8 * 1024 * 1024
MAX_FRED_RESPONSE_BYTES = 4 * 1024 * 1024
MAX_MOF_RESPONSE_BYTES = 4 * 1024 * 1024

NY_TZ = ZoneInfo("America/New_York")
WINDOW_MONTHS = int(os.environ.get("EQUITY_CALENDAR_MONTHS", "6"))
PRICE_SOURCE = os.environ.get("EQUITY_PRICE_SOURCE", "alpaca").strip().lower()
ALPACA_FEED = os.environ.get("EQUITY_US_FEED", os.environ.get("CHIP_CHAIN_US_FEED", "iex")).strip().lower()
CACHE_MAX_AGE_MINUTES = int(os.environ.get("EQUITY_CACHE_MAX_AGE_MINUTES", "55"))
END_DATE = pd.Timestamp(os.environ.get("EQUITY_CALENDAR_END_DATE", datetime.now(NY_TZ).date().isoformat())).normalize()
EVENT_LOOKAHEAD_DAYS = int(os.environ.get("EQUITY_EVENT_LOOKAHEAD_DAYS", "45"))
EVENT_END_DATE = END_DATE + pd.DateOffset(days=EVENT_LOOKAHEAD_DAYS)
WINDOW_START = (END_DATE - pd.DateOffset(months=WINDOW_MONTHS)).normalize()
LOOKBACK_START = (WINDOW_START - pd.DateOffset(days=10)).normalize()

ASSETS = {
    "QQQ": {
        "symbol": "QQQ",
        "displaySymbol": "QQQ",
        "name": "Invesco QQQ Trust",
        "role": "Nasdaq 100 proxy",
        "quote": "USD",
    },
    "SPY": {
        "symbol": "SPY",
        "displaySymbol": "SPY",
        "name": "SPDR S&P 500 ETF Trust",
        "role": "S&P 500 proxy",
        "quote": "USD",
    },
    "DIA": {
        "symbol": "DIA",
        "displaySymbol": "DOW",
        "name": "SPDR Dow Jones Industrial Average ETF Trust",
        "role": "Dow Jones Industrial Average ETF proxy",
        "quote": "USD",
    },
    "SOX": {
        "symbol": "SOX",
        "providerSymbol": "^SOX",
        "displaySymbol": "SOX",
        "name": "PHLX Semiconductor Index",
        "role": "Philadelphia Semiconductor Index",
        "quote": "index",
    },
}

OPTIONAL_ASSETS = {"SOX"}

FRED_SERIES = {
    "DGS10": {
        "label": "10Y Treasury",
        "unit": "percent",
        "kind": "yield",
        "sourcePolicyId": "fred-government",
    },
    "VIXCLS": {
        "label": "VIX",
        "unit": "index",
        "kind": "volatility",
        "sourcePolicyId": "fred-third-party",
    },
}

OFFICIAL_RATE_SERIES = {
    "JGB10Y": {
        "label": "Japan 10Y JGB",
        "labelZh": "日本10年国债收益率",
        "unit": "percent",
        "kind": "yield",
        "cadence": "daily",
        "dateMeaning": "japan_market_close_1500_jst",
        "source": "Japan Ministry of Finance",
        "sourceColumn": "10Y",
        "sourceUrl": MOF_JGB_CURRENT_URL,
        "historyUrl": MOF_JGB_HISTORY_URL,
        "methodologyUrl": MOF_JGB_METHODOLOGY_URL,
    },
}

MACRO_SERIES = {**FRED_SERIES, **OFFICIAL_RATE_SERIES}


@dataclass
class DailyPrices:
    symbol: str
    source: str
    frame: pd.DataFrame
    cache_status: str


def iso_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)
    except (TypeError, ValueError):
        return None


def observation_timestamp(value: object) -> str | None:
    parsed = parse_timestamp(str(value) if value is not None else None)
    return parsed.isoformat().replace("+00:00", "Z") if parsed is not None else None


def oldest_provider_fetch_at() -> str | None:
    timestamps: list[datetime] = []
    paths: list[Path] = []
    if source_is_eligible("alpaca", scope=DATA_USE_SCOPE, environment=os.environ):
        paths.extend(CACHE_DIR / f"price-{asset_price_symbol(symbol)}.json" for symbol in ASSETS)
    if source_is_eligible("japan-mof", scope=DATA_USE_SCOPE, environment=os.environ):
        paths.append(MOF_JGB10Y_CACHE_PATH)
    for series_id in FRED_SERIES:
        source_policy_id = str(FRED_SERIES[series_id]["sourcePolicyId"])
        if not source_is_eligible(source_policy_id, scope=DATA_USE_SCOPE, environment=os.environ):
            continue
        local_path = fred_cache_path(series_id)
        paths.append(local_path if local_path.exists() else SHARED_FRED_CACHE_DIR / f"{series_id}.json")
    for path in paths:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError):
            continue
        timestamp = parse_timestamp(payload.get("fetchedAt"))
        if timestamp is not None:
            timestamps.append(timestamp)
    return min(timestamps).isoformat().replace("+00:00", "Z") if timestamps else None


def latest_observed_at(latest_assets: dict, latest_date: str) -> str:
    timestamps = [
        parse_timestamp(item.get("asOf"))
        for item in latest_assets.values()
        if isinstance(item, dict)
    ]
    valid = [timestamp for timestamp in timestamps if timestamp is not None]
    if valid:
        return max(valid).isoformat().replace("+00:00", "Z")
    market_close = datetime.combine(date.fromisoformat(latest_date), time(16, 0), NY_TZ)
    return market_close.astimezone(UTC).isoformat().replace("+00:00", "Z")


def read_existing() -> dict | None:
    try:
        return json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def asset_price_symbol(symbol: str) -> str:
    return str(ASSETS.get(symbol, {}).get("providerSymbol") or symbol)


def read_recurring_event_definitions() -> list[dict]:
    payload = json.loads(RECURRING_EVENTS_PATH.read_text(encoding="utf-8"))
    definitions = payload.get("events") if isinstance(payload, dict) else None
    if not isinstance(definitions, list):
        raise RuntimeError("equity recurring event config must contain an events array")
    output: list[dict] = []
    for item in definitions:
        recurrence = item.get("recurrence") if isinstance(item, dict) else None
        recurrence_type = recurrence.get("type") if isinstance(recurrence, dict) else None
        if recurrence_type not in {"monthly", "annual"}:
            raise RuntimeError(f"unsupported equity event recurrence: {recurrence_type}")
        if item.get("category") != "liquidity" or not item.get("labelZh") or not item.get("labelEn"):
            raise RuntimeError(f"invalid bilingual liquidity event: {item.get('id')}")
        output.append(item)
    return output


RECURRING_EVENT_DEFINITIONS = read_recurring_event_definitions()


def recurring_events_for_date(day: pd.Timestamp) -> list[dict]:
    events: list[dict] = []
    for definition in RECURRING_EVENT_DEFINITIONS:
        recurrence = definition["recurrence"]
        matches = day.day == int(recurrence["day"])
        if recurrence["type"] == "annual":
            matches = matches and day.month == int(recurrence["month"])
        if not matches:
            continue
        events.append({
            "id": f"{definition['id']}:{day.strftime('%Y-%m-%d')}",
            "seriesId": definition["id"],
            "date": day.strftime("%Y-%m-%d"),
            "category": "liquidity",
            "categoryLabelZh": "流动性",
            "categoryLabelEn": "Liquidity",
            "labelZh": definition["labelZh"],
            "labelEn": definition["labelEn"],
            "noteZh": definition.get("noteZh", ""),
            "noteEn": definition.get("noteEn", ""),
            "source": definition.get("source", "Reviewed recurring event config"),
            "sourceUrl": definition.get("sourceUrl"),
            "dateMeaning": definition.get("dateMeaning", "calendar_anchor"),
            "cadence": recurrence["type"],
        })
    return events


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


def observed_fixed_holiday(year: int, month: int, day: int) -> date:
    holiday = date(year, month, day)
    if holiday.weekday() == 5:
        return holiday - timedelta(days=1)
    if holiday.weekday() == 6:
        return holiday + timedelta(days=1)
    return holiday


def nth_weekday(year: int, month: int, weekday: int, occurrence: int) -> date:
    current = date(year, month, 1)
    offset = (weekday - current.weekday()) % 7
    return current + timedelta(days=offset + (occurrence - 1) * 7)


def last_weekday(year: int, month: int, weekday: int) -> date:
    current = (date(year, month, 1) + pd.offsets.MonthEnd(0)).date()
    offset = (current.weekday() - weekday) % 7
    return current - timedelta(days=offset)


def easter_date(year: int) -> date:
    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = ((h + l - 7 * m + 114) % 31) + 1
    return date(year, month, day)


def nyse_holidays(year: int) -> set[date]:
    holidays = {
        observed_fixed_holiday(year, 1, 1),
        nth_weekday(year, 1, 0, 3),
        nth_weekday(year, 2, 0, 3),
        easter_date(year) - timedelta(days=2),
        last_weekday(year, 5, 0),
        observed_fixed_holiday(year, 7, 4),
        nth_weekday(year, 9, 0, 1),
        nth_weekday(year, 11, 3, 4),
        observed_fixed_holiday(year, 12, 25),
    }
    if year >= 2022:
        holidays.add(observed_fixed_holiday(year, 6, 19))
    return holidays


def is_market_day(day: pd.Timestamp) -> bool:
    as_date = day.date()
    if day.weekday() >= 5:
        return False
    holiday_years = {as_date.year - 1, as_date.year, as_date.year + 1}
    holidays = set().union(*(nyse_holidays(year) for year in holiday_years))
    return as_date not in holidays


def market_status(now: datetime | None = None) -> dict:
    now = now or datetime.now(NY_TZ)
    today = pd.Timestamp(now.date())
    market_day = is_market_day(today)
    open_time = datetime.combine(now.date(), time(9, 30), NY_TZ)
    close_time = datetime.combine(now.date(), time(16, 0), NY_TZ)
    is_open = market_day and open_time <= now <= close_time
    return {
        "timezone": "America/New_York",
        "date": now.date().isoformat(),
        "isMarketDay": market_day,
        "isOpen": is_open,
        "session": "open" if is_open else "closed",
        "refreshCadence": "hourly while U.S. equity markets are open; otherwise last close",
    }


def cache_is_fresh(path: Path, status: dict) -> bool:
    if not path.exists():
        return False
    modified = datetime.fromtimestamp(path.stat().st_mtime, UTC)
    age = datetime.now(UTC) - modified
    if status["isOpen"]:
        return age <= timedelta(minutes=CACHE_MAX_AGE_MINUTES)
    return modified.astimezone(NY_TZ).date().isoformat() == status["date"]


def normalize_price_frame(frame: pd.DataFrame) -> pd.DataFrame:
    frame = frame.rename(columns={column: str(column).lower().replace(" ", "_") for column in frame.columns})
    if "date" in frame.columns:
        frame["date"] = pd.to_datetime(frame["date"], errors="coerce")
        frame = frame.dropna(subset=["date"]).set_index("date")
    frame.index = pd.to_datetime(frame.index).tz_localize(None).normalize()
    for column in ["open", "high", "low", "close", "volume"]:
        if column not in frame.columns:
            frame[column] = None
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    frame = frame[["open", "high", "low", "close", "volume"]].dropna(subset=["open", "close"]).sort_index()
    return frame


def read_price_cache(symbol: str) -> DailyPrices | None:
    path = CACHE_DIR / f"price-{symbol}.csv"
    meta_path = CACHE_DIR / f"price-{symbol}.json"
    if not path.exists():
        return None
    try:
        frame = pd.read_csv(path, parse_dates=["date"]).set_index("date")
        frame = normalize_price_frame(frame)
        meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
        return DailyPrices(symbol=symbol, source=meta.get("source", "local price cache"), frame=frame, cache_status="cache")
    except Exception:
        return None


def write_price_cache(prices: DailyPrices) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    frame = prices.frame.reset_index().rename(columns={"index": "date"})
    csv_path = CACHE_DIR / f"price-{prices.symbol}.csv"
    temporary_csv_path = csv_path.with_name(f"{csv_path.name}.tmp")
    frame.to_csv(temporary_csv_path, index=False)
    temporary_csv_path.replace(csv_path)
    write_json_atomic(
        CACHE_DIR / f"price-{prices.symbol}.json",
        {"source": prices.source, "fetchedAt": iso_now()},
    )


def write_json_atomic(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_name(f"{path.name}.tmp")
    temporary_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary_path.replace(path)


def alpaca_credentials() -> tuple[str, str]:
    key_id = os.environ.get("APCA_API_KEY_ID", "").strip()
    secret_key = os.environ.get("APCA_API_SECRET_KEY", "").strip()
    if not key_id or not secret_key:
        raise RuntimeError("Alpaca credentials are not configured")
    return key_id, secret_key


def alpaca_feed() -> str:
    if ALPACA_FEED not in {"iex", "delayed_sip", "sip"}:
        raise RuntimeError("EQUITY_US_FEED must be iex, delayed_sip, or sip")
    return ALPACA_FEED


def bounded_json_response(response: requests.Response, maximum_bytes: int = MAX_ALPACA_RESPONSE_BYTES) -> dict:
    declared_length = response.headers.get("content-length")
    if declared_length:
        try:
            if int(declared_length) > maximum_bytes:
                raise RuntimeError("Provider response exceeds the configured byte limit")
        except ValueError as exc:
            raise RuntimeError("Provider returned an invalid Content-Length header") from exc
    chunks: list[bytes] = []
    total = 0
    for chunk in response.iter_content(chunk_size=64 * 1024):
        if not chunk:
            continue
        total += len(chunk)
        if total > maximum_bytes:
            response.close()
            raise RuntimeError("Provider response exceeds the configured byte limit")
        chunks.append(chunk)
    try:
        payload = json.loads(b"".join(chunks).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError("Alpaca response is not valid UTF-8 JSON") from exc
    if not isinstance(payload, dict):
        raise RuntimeError("Alpaca response must be a JSON object")
    return payload


def alpaca_get(path: str, params: dict[str, str | int]) -> dict:
    key_id, secret_key = alpaca_credentials()
    response = requests.get(
        f"{ALPACA_DATA_ORIGIN}{path}",
        params=params,
        headers={
            "APCA-API-KEY-ID": key_id,
            "APCA-API-SECRET-KEY": secret_key,
            "Accept": "application/json",
            "User-Agent": "cyclelens-equity-data/1.0",
        },
        timeout=(10, 45),
        allow_redirects=False,
        stream=True,
    )
    try:
        if 300 <= response.status_code < 400:
            raise RuntimeError("Alpaca response redirected unexpectedly")
        response.raise_for_status()
        return bounded_json_response(response)
    finally:
        response.close()


def source_alpaca_daily(symbol: str) -> DailyPrices:
    if symbol.startswith("^"):
        raise RuntimeError(f"Alpaca stock bars do not provide the index symbol {symbol}")
    rows: list[dict] = []
    page_token: str | None = None
    for _ in range(5):
        params: dict[str, str | int] = {
            "timeframe": "1Day",
            "start": LOOKBACK_START.strftime("%Y-%m-%d"),
            "end": (END_DATE + pd.DateOffset(days=1)).strftime("%Y-%m-%d"),
            "limit": 10_000,
            "feed": alpaca_feed(),
        }
        if page_token:
            params["page_token"] = page_token
        payload = alpaca_get(f"/v2/stocks/{symbol}/bars", params)
        page_rows = payload.get("bars")
        if not isinstance(page_rows, list):
            raise RuntimeError("Alpaca bars response is missing bars")
        rows.extend(item for item in page_rows if isinstance(item, dict))
        page_token = payload.get("next_page_token")
        if not page_token:
            break
    if page_token:
        raise RuntimeError("Alpaca bars response exceeded the pagination limit")
    frame = pd.DataFrame([
        {
            "date": item.get("t"),
            "open": item.get("o"),
            "high": item.get("h"),
            "low": item.get("l"),
            "close": item.get("c"),
            "volume": item.get("v"),
        }
        for item in rows
    ])
    if frame.empty:
        raise RuntimeError(f"Alpaca returned no rows for {symbol}")
    frame = normalize_price_frame(frame)
    source = f"Alpaca Market Data official {alpaca_feed().upper()} daily bars"
    return DailyPrices(symbol=symbol, source=source, frame=frame, cache_status="fresh")


def fetch_daily_prices(symbol: str, failures: list[str], status: dict) -> DailyPrices:
    source_allowed = source_is_eligible("alpaca", scope=DATA_USE_SCOPE, environment=os.environ)
    if not source_allowed:
        failures.append(f"{symbol}: Alpaca is not eligible for {DATA_USE_SCOPE}; provider cache not read")
        raise RuntimeError(f"Alpaca is not eligible for data-use scope {DATA_USE_SCOPE}")
    cached = read_price_cache(symbol)
    if cached and cache_is_fresh(CACHE_DIR / f"price-{symbol}.csv", status):
        cached.frame = cached.frame[cached.frame.index >= LOOKBACK_START]
        return cached

    providers = {"alpaca": source_alpaca_daily}
    ordered = [PRICE_SOURCE]
    last_error: Exception | None = None
    for provider_name in ordered:
        provider = providers.get(provider_name)
        if provider is None:
            continue
        try:
            result = provider(symbol)
            result.frame = result.frame[result.frame.index >= LOOKBACK_START]
            if result.frame.empty:
                raise RuntimeError(f"{provider_name} has no rows after {LOOKBACK_START.date()}")
            write_price_cache(result)
            return result
        except Exception as exc:  # noqa: BLE001 - provider failures become cache provenance.
            last_error = exc
            failures.append(f"{symbol} {provider_name}: provider request failed")

    if cached:
        cached.frame = cached.frame[cached.frame.index >= LOOKBACK_START]
        cached.cache_status = "stale-cache"
        failures.append(f"{symbol}: using stale local price cache after provider failure")
        return cached
    raise RuntimeError(f"No price source produced data for {symbol}") from last_error


def fred_cache_path(series_id: str) -> Path:
    return CACHE_DIR / f"fred-{series_id}.json"


def read_fred_cache(series_id: str) -> pd.Series | None:
    for path in [fred_cache_path(series_id), SHARED_FRED_CACHE_DIR / f"{series_id}.json"]:
        if not path.exists():
            continue
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            rows = payload.get("observations", [])
            series = pd.Series({row["date"]: row["value"] for row in rows})
            series.index = pd.to_datetime(series.index)
            return pd.to_numeric(series, errors="coerce").dropna()
        except Exception:
            continue
    return None


def write_fred_cache(series_id: str, series: pd.Series) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    rows = [
        {"date": index.strftime("%Y-%m-%d"), "value": finite_number(value)}
        for index, value in series.sort_index().items()
        if finite_number(value) is not None
    ]
    write_json_atomic(
        fred_cache_path(series_id),
        {"seriesId": series_id, "fetchedAt": iso_now(), "observations": rows},
    )


def fetch_fred_series_via_rest(series_id: str) -> pd.Series:
    api_key = os.environ.get("FRED_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("FRED_API_KEY is not configured")
    payload = get_json_bounded(
        FRED_OBSERVATIONS_URL,
        allowed_origins=FRED_ALLOWED_ORIGINS,
        params={
            "series_id": series_id,
            "api_key": api_key,
            "file_type": "json",
            "observation_start": LOOKBACK_START.strftime("%Y-%m-%d"),
        },
        headers={"User-Agent": "cyclelens-equity-data/1.0"},
        maximum_bytes=MAX_FRED_RESPONSE_BYTES,
    )
    rows: dict[pd.Timestamp, float] = {}
    for observation in payload.get("observations", []):
        if not isinstance(observation, dict):
            continue
        value = finite_number(observation.get("value"))
        if value is None:
            continue
        try:
            observed_date = pd.Timestamp(observation.get("date")).normalize()
        except (TypeError, ValueError):
            continue
        rows[observed_date] = value
    if not rows:
        raise RuntimeError(f"FRED returned no valid observations for {series_id}")
    series = pd.Series(rows, dtype="float64").sort_index()
    series.name = series_id
    return series


def fetch_fred_series(failures: list[str], status: dict) -> dict[str, pd.Series]:
    output: dict[str, pd.Series] = {}
    for series_id, definition in FRED_SERIES.items():
        source_policy_id = str(definition["sourcePolicyId"])
        source_allowed = source_is_eligible(source_policy_id, scope=DATA_USE_SCOPE, environment=os.environ)
        if not source_allowed:
            failures.append(f"FRED {series_id}: source is not eligible for {DATA_USE_SCOPE}; provider cache not read")
            continue
        cached = read_fred_cache(series_id)
        if cached is not None and cache_is_fresh(fred_cache_path(series_id), status):
            output[series_id] = cached[cached.index >= LOOKBACK_START]
            continue
        try:
            series = fetch_fred_series_via_rest(series_id)
            write_fred_cache(series_id, series)
            output[series_id] = series
        except Exception:  # noqa: BLE001
            failures.append(f"FRED {series_id}: provider request failed")
            if cached is not None:
                output[series_id] = cached[cached.index >= LOOKBACK_START]
                failures.append(f"FRED {series_id}: using stale local cache")
    return output


def parse_mof_jgb10y_csv(text: str) -> pd.Series:
    lines = text.lstrip("\ufeff").splitlines()
    header_index = next((index for index, line in enumerate(lines) if line.strip().startswith("Date,")), None)
    if header_index is None:
        raise RuntimeError("MOF JGB CSV is missing the Date header")
    rows: dict[pd.Timestamp, float] = {}
    for row in csv.DictReader(StringIO("\n".join(lines[header_index:]))):
        date_text = str(row.get("Date") or "").strip()
        value = finite_number(row.get("10Y"))
        if not date_text or value is None:
            continue
        try:
            observed_date = pd.to_datetime(date_text, format="%Y/%m/%d").normalize()
        except (TypeError, ValueError):
            continue
        rows[observed_date] = value
    if not rows:
        raise RuntimeError("MOF JGB CSV returned no valid 10Y observations")
    series = pd.Series(rows, dtype="float64").sort_index()
    series.name = "JGB10Y"
    return series


def read_mof_jgb10y_cache() -> pd.Series | None:
    try:
        payload = json.loads(MOF_JGB10Y_CACHE_PATH.read_text(encoding="utf-8"))
        rows = payload.get("observations", [])
        series = pd.Series({row["date"]: row["value"] for row in rows})
        series.index = pd.to_datetime(series.index)
        series = pd.to_numeric(series, errors="coerce").dropna().sort_index()
        return series if not series.empty else None
    except (FileNotFoundError, json.JSONDecodeError, KeyError, TypeError, ValueError):
        return None


def write_mof_jgb10y_cache(series: pd.Series) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    rows = [
        {"date": index.strftime("%Y-%m-%d"), "value": finite_number(value)}
        for index, value in series.sort_index().items()
        if finite_number(value) is not None
    ]
    payload = {
        "seriesId": "JGB10Y",
        "fetchedAt": iso_now(),
        "source": "Japan Ministry of Finance",
        "sourceUrl": MOF_JGB_HISTORY_URL,
        "sourceColumn": "10Y",
        "unit": "percent",
        "dateMeaning": "japan_market_close_1500_jst",
        "observations": rows,
    }
    write_json_atomic(MOF_JGB10Y_CACHE_PATH, payload)


def fetch_mof_jgb10y(failures: list[str], status: dict) -> pd.Series | None:
    source_allowed = source_is_eligible("japan-mof", scope=DATA_USE_SCOPE, environment=os.environ)
    if not source_allowed:
        failures.append(f"Japan MOF JGB10Y: source is not eligible for {DATA_USE_SCOPE}; provider cache not read")
        raise RuntimeError(f"Japan MOF JGB10Y is not eligible for data-use scope {DATA_USE_SCOPE}")
    cached = read_mof_jgb10y_cache()
    recent_enough = cached is not None and cached.index[-1] >= END_DATE - pd.DateOffset(days=7)
    if recent_enough and cache_is_fresh(MOF_JGB10Y_CACHE_PATH, status):
        return cached[cached.index >= LOOKBACK_START]
    try:
        series_parts: list[pd.Series] = []
        for source_url in [MOF_JGB_HISTORY_URL, MOF_JGB_CURRENT_URL]:
            response = requests.get(
                source_url,
                timeout=(10, 45),
                headers={"User-Agent": "cyclelens-market-data/1.0"},
                allow_redirects=False,
                stream=True,
            )
            try:
                if 300 <= response.status_code < 400:
                    raise RuntimeError("Japan MOF response redirected unexpectedly")
                response.raise_for_status()
                chunks: list[bytes] = []
                total = 0
                for chunk in response.iter_content(chunk_size=64 * 1024):
                    if not chunk:
                        continue
                    total += len(chunk)
                    if total > MAX_MOF_RESPONSE_BYTES:
                        raise RuntimeError("Japan MOF response exceeds the configured byte limit")
                    chunks.append(chunk)
                encoding = response.encoding or "utf-8"
                text = b"".join(chunks).decode(encoding, errors="strict")
                series_parts.append(parse_mof_jgb10y_csv(text))
            finally:
                response.close()
        series = pd.concat(series_parts)
        series = series[~series.index.duplicated(keep="last")].sort_index()
        write_mof_jgb10y_cache(series)
        return series[series.index >= LOOKBACK_START]
    except Exception as exc:  # noqa: BLE001 - official-source failures use last-known-good cache.
        failures.append("Japan MOF JGB10Y: provider request failed")
        if cached is not None:
            failures.append("Japan MOF JGB10Y: using stale local cache")
            return cached[cached.index >= LOOKBACK_START]
        raise RuntimeError("Japan MOF JGB10Y has no last-known-good cache") from exc


def macro_observation(series: pd.Series | None, date_key: str) -> dict | None:
    if series is None or series.empty:
        return None
    target = pd.Timestamp(date_key)
    available = series[series.index <= target]
    if available.empty:
        return None
    end_date = available.index[-1]
    end_value = finite_number(available.iloc[-1])
    previous = series[series.index < end_date]
    start_date = previous.index[-1] if not previous.empty else None
    start_value = finite_number(previous.iloc[-1]) if not previous.empty else None
    change = None if end_value is None or start_value is None else end_value - start_value
    return {
        "date": end_date.strftime("%Y-%m-%d"),
        "value": end_value,
        "previous": start_value,
        "change": change,
        "changeBp": None if change is None else change * 100,
        "carriedForward": end_date.strftime("%Y-%m-%d") != date_key,
    }


def daily_asset_row(frame: pd.DataFrame, date_key: str, symbol: str) -> dict | None:
    target = pd.Timestamp(date_key)
    if target not in frame.index:
        return None
    row = frame.loc[target]
    open_value = finite_number(row.get("open"))
    close_value = finite_number(row.get("close"))
    return {
        "symbol": symbol,
        "date": date_key,
        "open": open_value,
        "high": finite_number(row.get("high")),
        "low": finite_number(row.get("low")),
        "close": close_value,
        "price": close_value,
        "pct": pct_change(open_value, close_value),
        "volume": finite_number(row.get("volume")),
        "priceType": "close",
    }


def fetch_delayed_spot_quotes(failures: list[str]) -> dict[str, dict]:
    if not source_is_eligible("alpaca", scope=DATA_USE_SCOPE, environment=os.environ):
        failures.append(f"Alpaca latest bars: source is not eligible for {DATA_USE_SCOPE}")
        return {}
    try:
        symbols = sorted(set(ASSETS) - {"SOX"})
        payload = alpaca_get("/v2/stocks/bars/latest", {
            "symbols": ",".join(symbols),
            "feed": alpaca_feed(),
        })
    except Exception:  # noqa: BLE001 - live quote failures retain daily LKG.
        failures.append("Alpaca latest bars: provider request failed")
        return {}
    bars = payload.get("bars")
    if not isinstance(bars, dict):
        failures.append("Alpaca latest bars: invalid provider response")
        return {}
    output: dict[str, dict] = {}
    for symbol in symbols:
        row = bars.get(symbol)
        if not isinstance(row, dict):
            continue
        price = finite_number(row.get("c"))
        open_value = finite_number(row.get("o"))
        output[symbol] = {
            "symbol": symbol,
            "price": price,
            "open": open_value,
            "previousClose": None,
            "pct": pct_change(open_value, price),
            "source": f"Alpaca Market Data official {alpaca_feed().upper()} latest bar",
            "asOf": observation_timestamp(row.get("t")) or iso_now(),
        }
    return output


def build_latest_assets(days: list[dict], spot_quotes: dict[str, dict], status: dict) -> dict[str, dict | None]:
    latest = {}
    for symbol in ASSETS:
        daily = next((day["assets"].get(symbol) for day in reversed(days) if day["assets"].get(symbol)), None)
        quote = spot_quotes.get(symbol)
        if quote and quote.get("price") is not None and status["isOpen"]:
            base_open = quote.get("open") or (daily.get("open") if daily else None)
            latest[symbol] = {
                **(daily or {"symbol": symbol}),
                "price": quote["price"],
                "close": quote["price"],
                "open": base_open,
                "pct": quote.get("pct") if quote.get("pct") is not None else pct_change(base_open, quote["price"]),
                "priceType": "delayed",
                "source": quote.get("source"),
                "asOf": quote.get("asOf"),
            }
        else:
            latest[symbol] = daily
    return latest


def day_range() -> list[pd.Timestamp]:
    return list(pd.date_range(WINDOW_START, EVENT_END_DATE, freq="D"))


def build_output() -> dict:
    failures: list[str] = []
    status = market_status()
    price_daily: dict[str, DailyPrices | None] = {}
    for symbol in ASSETS:
        try:
            price_daily[symbol] = fetch_daily_prices(asset_price_symbol(symbol), failures, status)
        except Exception:  # noqa: BLE001 - optional asset failures stay visible without blocking the calendar.
            if symbol not in OPTIONAL_ASSETS:
                raise
            failures.append(f"{symbol}: optional index unavailable")
            price_daily[symbol] = None
    macro_daily = fetch_fred_series(failures, status)
    missing_fred_series = sorted(set(FRED_SERIES) - set(macro_daily))
    if os.environ.get("CYCLELENS_REQUIRE_FRESH_OWNER_RELEASE") == "1" and missing_fred_series:
        raise RuntimeError("Not every required equity FRED series refreshed")
    macro_daily["JGB10Y"] = fetch_mof_jgb10y(failures, status)
    if (
        os.environ.get("CYCLELENS_REQUIRE_FRESH_OWNER_RELEASE") == "1"
        and macro_daily["JGB10Y"] is None
    ):
        raise RuntimeError("The required official Japan 10Y series did not refresh")
    spot_quotes = fetch_delayed_spot_quotes(failures) if status["isOpen"] else {}

    days = []
    for day in day_range():
        date_key = day.strftime("%Y-%m-%d")
        market_day = is_market_day(day)
        within_observation_window = day <= END_DATE
        assets = {
            symbol: daily_asset_row(prices.frame, date_key, symbol) if prices is not None and within_observation_window else None
            for symbol, prices in price_daily.items()
        }
        macro = {
            series_id: macro_observation(macro_daily.get(series_id), date_key) if market_day and within_observation_window else None
            for series_id in MACRO_SERIES
        }
        row = {
            "date": date_key,
            "dayOfWeek": int(day.weekday()),
            "isMarketDay": market_day,
            "assets": assets if market_day else {symbol: None for symbol in ASSETS},
            "macro": macro if market_day else {series_id: None for series_id in MACRO_SERIES},
        }
        events = recurring_events_for_date(day)
        if events:
            row["events"] = events
        days.append(row)

    trading_days = [day for day in days if day["isMarketDay"] and any(day.get("assets", {}).values())]
    if not trading_days:
        raise RuntimeError("No daily equity rows produced")

    latest_assets = build_latest_assets(trading_days, spot_quotes, status)
    latest_macro_date = trading_days[-1]["date"]
    latest_macro = {
        series_id: macro_observation(macro_daily.get(series_id), latest_macro_date)
        for series_id in MACRO_SERIES
    }
    transformed_at = iso_now()
    required_price_assets = sorted(set(ASSETS) - OPTIONAL_ASSETS)
    fresh_price_assets = sorted(
        symbol
        for symbol in required_price_assets
        if price_daily[symbol] is not None and price_daily[symbol].cache_status == "fresh"
    )
    if (
        os.environ.get("CYCLELENS_REQUIRE_FRESH_OWNER_RELEASE") == "1"
        and fresh_price_assets != required_price_assets
    ):
        raise RuntimeError("Not every required equity price asset refreshed")

    return {
        "version": 2,
        "page": "equity-macro",
        "dataUseScope": DATA_USE_SCOPE,
        "timezone": "America/New_York for trading dates; macro observations retain their provider dates",
        "generatedAt": transformed_at,
        "timestamps": {
            "observedAt": latest_observed_at(latest_assets, trading_days[-1]["date"]),
            "fetchedAt": oldest_provider_fetch_at(),
            "transformedAt": transformed_at,
        },
        "window": {
            "months": WINDOW_MONTHS,
            "startDate": WINDOW_START.strftime("%Y-%m-%d"),
            "endDate": END_DATE.strftime("%Y-%m-%d"),
            "eventEndDate": EVENT_END_DATE.strftime("%Y-%m-%d"),
        },
        "market": status,
        "methodology": (
            "Daily price rows are derived from official Alpaca Market Data daily OHLC for QQQ, SPY, and DIA, "
            "plus the legacy SOX last-known-good cache when available. "
            "DIA is used as a Dow Jones Industrial Average ETF proxy. "
            "U.S. 10Y and VIX use FRED daily observations. Japan 10Y JGB uses the Japan Ministry of Finance official "
            "15:00 JST constant-maturity close and displays the latest observation change versus the previous observation. "
            "Reviewed recurring crypto-supply and CEX-attention annotations are calendar anchors, not claims of guaranteed price impact."
        ),
        "priceSourcePreference": PRICE_SOURCE,
        "failures": failures,
        "refreshSummary": {
            "requiredPriceAssets": required_price_assets,
            "freshPriceAssets": fresh_price_assets,
            "requiredFredSeries": sorted(FRED_SERIES),
            "freshFredSeries": sorted(macro_daily.keys() & FRED_SERIES.keys()),
            "jgb10yRefreshed": macro_daily.get("JGB10Y") is not None,
        },
        "assets": {
            symbol: {
                **ASSETS[symbol],
                "sourceLabel": (
                    price_daily[symbol].source
                    if price_daily[symbol] is not None
                    else "Legacy SOX last-known-good unavailable; no unofficial refresh"
                ),
                "cacheStatus": price_daily[symbol].cache_status if price_daily[symbol] is not None else "unavailable",
                "rows": len(price_daily[symbol].frame) if price_daily[symbol] is not None else 0,
                "firstDate": price_daily[symbol].frame.index[0].strftime("%Y-%m-%d") if price_daily[symbol] is not None else None,
                "lastDate": price_daily[symbol].frame.index[-1].strftime("%Y-%m-%d") if price_daily[symbol] is not None else None,
            }
            for symbol in ASSETS
        },
        "macroSeries": MACRO_SERIES,
        "sources": {
            "prices": (
                "Official Alpaca Market Data bars for QQQ, SPY, and DIA. SOX is retained only from an existing "
                "last-known-good cache; unofficial AKShare and yfinance refreshes are disabled."
            ),
            "FRED": "https://fred.stlouisfed.org/docs/api/fred/",
            "Japan Ministry of Finance JGB": MOF_JGB_CURRENT_URL,
            "Japan Ministry of Finance JGB history": MOF_JGB_HISTORY_URL,
            "Japan Ministry of Finance methodology": MOF_JGB_METHODOLOGY_URL,
            "calendar": "Built-in NYSE holiday rules for regular full market closures; early closes are not modeled in this version.",
            "cache": (
                "tmp/owner-private/equity-cache"
                if DATA_USE_SCOPE == "owner_private"
                else "tmp/equity-cache"
            ),
            "recurringEvents": "app/data/equity-recurring-events.json",
        },
        "latest": {
            "date": trading_days[-1]["date"],
            "assets": latest_assets,
            "macro": latest_macro,
        },
        "days": days,
    }


def merge_optional_last_known_good(output: dict, existing: dict | None) -> dict:
    """Retain optional legacy rows without allowing them to become a fetch path."""
    if not existing:
        return output
    existing_days = {
        str(item.get("date")): item
        for item in existing.get("days", [])
        if isinstance(item, dict) and item.get("date")
    }
    retained_sox = 0
    retained_macro: dict[str, int] = {series_id: 0 for series_id in MACRO_SERIES}
    for row in output.get("days", []):
        prior = existing_days.get(str(row.get("date"))) or {}
        prior_assets = prior.get("assets") or {}
        row_assets = row.get("assets") or {}
        if row_assets.get("SOX") is None and prior_assets.get("SOX") is not None:
            row_assets["SOX"] = prior_assets["SOX"]
            retained_sox += 1
        prior_macro = prior.get("macro") or {}
        row_macro = row.get("macro") or {}
        for series_id in MACRO_SERIES:
            if row_macro.get(series_id) is None and prior_macro.get(series_id) is not None:
                row_macro[series_id] = prior_macro[series_id]
                retained_macro[series_id] += 1

    existing_latest = existing.get("latest") or {}
    latest = output.setdefault("latest", {})
    latest_assets = latest.setdefault("assets", {})
    if latest_assets.get("SOX") is None:
        latest_assets["SOX"] = (existing_latest.get("assets") or {}).get("SOX")
    latest_macro = latest.setdefault("macro", {})
    for series_id in MACRO_SERIES:
        if latest_macro.get(series_id) is None:
            latest_macro[series_id] = (existing_latest.get("macro") or {}).get(series_id)

    if retained_sox:
        existing_sox = (existing.get("assets") or {}).get("SOX") or {}
        output.setdefault("assets", {})["SOX"] = {
            **ASSETS["SOX"],
            **existing_sox,
            "sourceLabel": "Legacy SOX last-known-good only; unofficial refresh remains blocked",
            "cacheStatus": "seeded-last-known-good",
        }
        output.setdefault("failures", []).append(
            f"SOX: retained {retained_sox} legacy last-known-good rows; no unofficial refresh attempted"
        )
    for series_id, count in retained_macro.items():
        if count:
            output.setdefault("failures", []).append(
                f"FRED/MOF {series_id}: retained {count} last-known-good rows after provider unavailability"
            )
    output["dataUseScope"] = DATA_USE_SCOPE
    return output


def merge_recurring_events_into_existing(existing: dict) -> dict:
    output = json.loads(json.dumps(existing))
    output["dataUseScope"] = DATA_USE_SCOPE
    existing_days = {str(item.get("date")): item for item in output.get("days", []) if item.get("date")}
    has_sox_rows = any((item.get("assets") or {}).get("SOX") for item in existing_days.values())
    start_value = output.get("window", {}).get("startDate") or WINDOW_START.strftime("%Y-%m-%d")
    start_date = pd.Timestamp(start_value).normalize()
    market_end_date = pd.Timestamp(output.get("window", {}).get("endDate") or END_DATE).normalize()
    merged_days: list[dict] = []
    for day in pd.date_range(start_date, EVENT_END_DATE, freq="D"):
        date_key = day.strftime("%Y-%m-%d")
        row = dict(existing_days.get(date_key) or {
            "date": date_key,
            "dayOfWeek": int(day.weekday()),
            "isMarketDay": is_market_day(day),
        })
        if not has_sox_rows:
            row.setdefault("assets", {}).pop("SOX", None)
        if day > market_end_date:
            row.pop("assets", None)
            row.pop("macro", None)
        events = recurring_events_for_date(day)
        if events:
            row["events"] = events
        else:
            row.pop("events", None)
        merged_days.append(row)

    output.setdefault("assets", {})["SOX"] = {
        **ASSETS["SOX"],
        "sourceLabel": (
            output.get("assets", {}).get("SOX", {}).get("sourceLabel")
            or "Legacy SOX last-known-good unavailable; no unofficial refresh"
        ),
        "cacheStatus": output.get("assets", {}).get("SOX", {}).get("cacheStatus") or "unavailable",
        "rows": output.get("assets", {}).get("SOX", {}).get("rows") or 0,
        "firstDate": output.get("assets", {}).get("SOX", {}).get("firstDate"),
        "lastDate": output.get("assets", {}).get("SOX", {}).get("lastDate"),
    }
    output.setdefault("latest", {}).setdefault("assets", {})["SOX"] = output.get("latest", {}).get("assets", {}).get("SOX")
    output.setdefault("window", {})["eventEndDate"] = EVENT_END_DATE.strftime("%Y-%m-%d")
    output["days"] = merged_days
    output["eventAnnotations"] = {
        "transformedAt": iso_now(),
        "source": "app/data/equity-recurring-events.json",
        "lookaheadDays": EVENT_LOOKAHEAD_DAYS,
    }
    output.setdefault("sources", {})["recurringEvents"] = "app/data/equity-recurring-events.json"
    return output


def main() -> int:
    existing = read_existing()
    if os.environ.get("EQUITY_EVENTS_ONLY") == "1":
        if not existing:
            raise RuntimeError("EQUITY_EVENTS_ONLY requires an existing equity-weekly.json")
        output = merge_recurring_events_into_existing(existing)
        write_json_atomic(OUTPUT_PATH, output)
        print(json.dumps({
            "status": "merged-recurring-events",
            "outputPath": str(OUTPUT_PATH),
            "days": len(output["days"]),
            "eventRows": sum(1 for row in output["days"] if row.get("events")),
        }, ensure_ascii=False))
        return 0
    try:
        output = build_output()
    except Exception:  # noqa: BLE001
        if os.environ.get("CYCLELENS_REQUIRE_FRESH_OWNER_RELEASE") == "1":
            raise RuntimeError("Owner equity collector did not produce a fresh release candidate") from None
        if existing:
            print(json.dumps({
                "status": "kept-last-known-good",
                "outputPath": str(OUTPUT_PATH),
                "error": "owner collector failed; last-known-good retained",
            }, ensure_ascii=False))
            return 0
        raise

    output = merge_optional_last_known_good(output, existing)
    write_json_atomic(OUTPUT_PATH, output)
    print(json.dumps({
        "status": "updated",
        "outputPath": str(OUTPUT_PATH),
        "days": len(output["days"]),
        "failures": output["failures"],
        "lastDate": output["latest"]["date"],
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
