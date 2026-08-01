#!/usr/bin/env python
"""Build the fast static indicator cache for the U.S. market page.

Security posture:
- Runs only as a backend/local/CI script.
- Reads CMC values only from the bounded owner-private normalized provider
  state; this process has no CMC credential or CMC network path.
- Reads the FRED credential from environment variables or ignored local env
  files; never writes credentials to output.
- Writes only bounded derived indicators for the frontend.
- Preserves last-known-good values when a provider is unavailable.
"""

from __future__ import annotations

import json
import math
import os
import re
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from data_use_scope import (
    data_directory_for_scope,
    data_use_scope_from_environment,
    source_is_eligible,
)
from secure_http import get_json_bounded

APP_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = APP_ROOT.parent
DATA_USE_SCOPE = data_use_scope_from_environment(os.environ, sys.argv[1:])
DATA_DIRECTORY = data_directory_for_scope(APP_ROOT, DATA_USE_SCOPE)
OUTPUT_PATH = DATA_DIRECTORY / "equity-fast.json"
SLOW_EQUITY_PATH = DATA_DIRECTORY / "equity-weekly.json"
CMC_PROVIDER_STATE_PATH = WORKSPACE_ROOT / "tmp" / "owner-private" / "provider-state" / "coinmarketcap.json"

CMC_SOURCE_URL = "https://coinmarketcap.com/api/documentation/v1/"
FRED_OBSERVATIONS_URL = "https://api.stlouisfed.org/fred/series/observations"
FRED_ALLOWED_ORIGINS = frozenset({"https://api.stlouisfed.org"})
MAX_PROVIDER_RESPONSE_BYTES = 2 * 1024 * 1024
CMC_PROVIDER_STATE_MAX_BYTES = 4 * 1024 * 1024
CMC_PROVIDER_STATE_FRESH_SECONDS = 30 * 60
DENIED_CONSUMER_ENV_KEYS = frozenset({"CMC_PRO_API_KEY"})
CMC_PROVIDER_STATE_ASSETS = {
    "BTC": 1,
    "ETH": 1027,
    "USDT": 825,
    "USDC": 3408,
    "HYPE": 32196,
    "BNB": 1839,
}
CMC_PROVIDER_STATE_MODES = frozenset(
    {
        "refreshed",
        "disabled",
        "cadence_guard",
        "budget_guard",
        "provider_failed_lkg",
        "hydrated",
    }
)
CMC_PROVIDER_STATE_ACTIVE_MODES = CMC_PROVIDER_STATE_MODES - {"disabled"}
GOLD_SERIES_ID = "NASDAQQGLDI"
REFRESH_CADENCE = "Target 15 minutes for fast indicators; provider schedules and static deployment queues can add delay."


def iso_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)
    except (TypeError, ValueError):
        try:
            return datetime.fromisoformat(f"{value}T00:00:00+00:00")
        except (TypeError, ValueError):
            return None


def oldest_timestamp(values: list[str | None]) -> str | None:
    parsed = [timestamp for value in values if (timestamp := parse_timestamp(value)) is not None]
    return min(parsed).isoformat().replace("+00:00", "Z") if parsed else None


def load_env_file(path: Path) -> None:
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return
    for line in text.splitlines():
        trimmed = line.strip()
        if not trimmed or trimmed.startswith("#"):
            continue
        match = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$", trimmed)
        if not match or match.group(1) in DENIED_CONSUMER_ENV_KEYS or os.environ.get(match.group(1)):
            continue
        value = match.group(2).strip()
        if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
            value = value[1:-1]
        os.environ[match.group(1)] = value


def safe_error_message(error: Exception) -> str:
    output = str(error)
    for secret in [os.environ.get("FRED_API_KEY")]:
        if secret:
            output = output.replace(secret, "[REDACTED]")
    return output


def read_json(path: Path) -> dict[str, Any] | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def finite_number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number else None


def strict_finite_number(value: Any, *, minimum: float = -math.inf) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    return number if math.isfinite(number) and number >= minimum else None


def non_future_timestamp(value: Any, now: datetime) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    normalized = parsed.astimezone(UTC)
    if normalized > now:
        return None
    return normalized.isoformat().replace("+00:00", "Z")


def pct_change(previous: float | None, current: float | None) -> float | None:
    if previous is None or current is None or previous == 0:
        return None
    return ((current - previous) / previous) * 100


def fetch_json(
    url: str,
    *,
    allowed_origins: frozenset[str],
    params: dict[str, str],
    headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    return get_json_bounded(
        url,
        allowed_origins=allowed_origins,
        params=params,
        headers={
            "Accept": "application/json",
            "User-Agent": "cyclelens-equity-fast-cache/1.0",
            **(headers or {}),
        },
        maximum_bytes=MAX_PROVIDER_RESPONSE_BYTES,
    )


def cached_metric(existing: dict[str, Any] | None, metric_id: str) -> dict[str, Any] | None:
    if not existing:
        return None
    for metric in existing.get("metrics", []):
        if metric.get("id") == metric_id:
            return metric
    return None


def metric(
    metric_id: str,
    label: str,
    value: float | None,
    unit: str,
    source_label: str,
    source_url: str,
    as_of: str | None,
    change_pct: float | None = None,
    previous: float | None = None,
    quality: str = "fresh",
) -> dict[str, Any]:
    return {
        "id": metric_id,
        "label": label,
        "value": value,
        "unit": unit,
        "previous": previous,
        "changePct": change_pct,
        "asOf": as_of,
        "sourceLabel": source_label,
        "sourceUrl": source_url,
        "quality": quality,
    }


def invalid_cmc_provider_state(reason: str) -> dict[str, Any]:
    return {
        "valid": False,
        "fresh": False,
        "reason": reason,
        "mode": "policy_denied" if reason == "scope_denied" else "missing",
        "fetchedAt": None,
        "global": {},
        "assets": {},
        "metrics": {},
    }


def normalize_cmc_provider_state(
    payload: Any,
    *,
    now: datetime | None = None,
    max_fresh_seconds: int = CMC_PROVIDER_STATE_FRESH_SECONDS,
    allow_fresh: bool = True,
) -> dict[str, Any]:
    current_time = (now or datetime.now(UTC)).astimezone(UTC)
    if not isinstance(payload, dict) or (
        payload.get("version") != 1
        or payload.get("provider") != "coinmarketcap"
        or payload.get("dataUseScope") != "owner_private"
    ):
        return invalid_cmc_provider_state("invalid_identity")
    required_records = [
        payload.get("current"),
        payload.get("history"),
        payload.get("watermarks"),
        payload.get("budget"),
        payload.get("refresh"),
    ]
    if not all(isinstance(item, dict) for item in required_records):
        return invalid_cmc_provider_state("invalid_schema")

    current = payload["current"]
    refresh = payload["refresh"]
    global_row = current.get("global")
    assets = current.get("assets")
    updated_at = non_future_timestamp(payload.get("updatedAt"), current_time)
    fetched_at = non_future_timestamp(current.get("fetchedAt"), current_time)
    mode = refresh.get("mode")
    if (
        not isinstance(global_row, dict)
        or not isinstance(assets, dict)
        or not isinstance(refresh.get("currentRefreshed"), bool)
        or mode not in CMC_PROVIDER_STATE_MODES
        or updated_at is None
        or fetched_at is None
    ):
        return invalid_cmc_provider_state("invalid_current")

    total_value = strict_finite_number(global_row.get("totalMarketCapUsd"), minimum=0)
    total_previous = strict_finite_number(global_row.get("totalMarketCapYesterdayUsd"), minimum=0)
    total_change = strict_finite_number(global_row.get("totalMarketCapChangePct24h"))
    total_observed_at = non_future_timestamp(global_row.get("observedAt"), current_time)
    if (
        total_value is None
        or (global_row.get("totalMarketCapYesterdayUsd") is not None and total_previous is None)
        or (global_row.get("totalMarketCapChangePct24h") is not None and total_change is None)
        or total_observed_at is None
    ):
        return invalid_cmc_provider_state("invalid_current_values")

    normalized_assets: dict[str, dict[str, Any]] = {}
    for symbol, expected_id in CMC_PROVIDER_STATE_ASSETS.items():
        item = assets.get(symbol)
        if not isinstance(item, dict) or item.get("symbol") != symbol:
            return invalid_cmc_provider_state("invalid_current_assets")
        item_id = strict_finite_number(item.get("id"), minimum=1)
        price_usd = strict_finite_number(item.get("priceUsd"), minimum=0)
        market_cap_usd = strict_finite_number(item.get("marketCapUsd"), minimum=0)
        percent_change_24h = strict_finite_number(item.get("percentChange24h"))
        observed_at = non_future_timestamp(item.get("observedAt"), current_time)
        if (
            item_id is None
            or not item_id.is_integer()
            or item_id != expected_id
            or price_usd is None
            or market_cap_usd is None
            or (item.get("percentChange24h") is not None and percent_change_24h is None)
            or observed_at is None
        ):
            return invalid_cmc_provider_state("invalid_current_values")
        normalized_assets[symbol] = {
            "id": int(item_id),
            "priceUsd": price_usd,
            "marketCapUsd": market_cap_usd,
            "percentChange24h": percent_change_24h,
            "observedAt": observed_at,
        }
    btc = normalized_assets["BTC"]

    fetched_time = datetime.fromisoformat(fetched_at.replace("Z", "+00:00"))
    fresh = (
        allow_fresh
        and refresh["currentRefreshed"] is True
        and mode not in {"disabled", "missing", "policy_denied"}
        and (current_time - fetched_time).total_seconds() <= max(0, max_fresh_seconds)
    )
    quality = "fresh" if fresh else "last-known-good"
    source_label = (
        "CoinMarketCap normalized provider state"
        if fresh
        else "CoinMarketCap normalized provider state (last-known-good)"
    )
    metrics = {
        "BTC_MARKET_CAP": {
            **metric(
                "BTC_MARKET_CAP",
                "BTC market cap",
                btc["marketCapUsd"],
                "USD",
                source_label,
                CMC_SOURCE_URL,
                btc["observedAt"],
                btc["percentChange24h"],
                quality=quality,
            ),
            "fetchedAt": fetched_at,
        },
        "CRYPTO_MARKET_CAP": {
            **metric(
                "CRYPTO_MARKET_CAP",
                "Total crypto market cap",
                total_value,
                "USD",
                source_label,
                CMC_SOURCE_URL,
                total_observed_at,
                total_change,
                total_previous,
                quality=quality,
            ),
            "fetchedAt": fetched_at,
        },
    }
    return {
        "valid": True,
        "fresh": fresh,
        "reason": "current" if fresh else "last_known_good",
        "mode": mode,
        "updatedAt": updated_at,
        "fetchedAt": fetched_at,
        "global": {
            "totalMarketCapUsd": total_value,
            "totalMarketCapYesterdayUsd": total_previous,
            "totalMarketCapChangePct24h": total_change,
            "observedAt": total_observed_at,
        },
        "assets": normalized_assets,
        "metrics": metrics,
    }


def cmc_current_is_available(state: Any) -> bool:
    global_row = state.get("global") if isinstance(state, dict) else None
    if (
        not isinstance(state, dict)
        or state.get("valid") is not True
        or state.get("mode") not in CMC_PROVIDER_STATE_ACTIVE_MODES
        or not isinstance(state.get("fetchedAt"), str)
        or not isinstance(global_row, dict)
        or strict_finite_number(global_row.get("totalMarketCapUsd"), minimum=0) is None
    ):
        return False
    assets = state.get("assets")
    if not isinstance(assets, dict):
        return False
    return all(
        isinstance(assets.get(symbol), dict)
        and strict_finite_number(assets[symbol].get("id"), minimum=1) == expected_id
        and strict_finite_number(assets[symbol].get("priceUsd"), minimum=0) is not None
        and strict_finite_number(assets[symbol].get("marketCapUsd"), minimum=0) is not None
        and isinstance(assets[symbol].get("observedAt"), str)
        for symbol, expected_id in CMC_PROVIDER_STATE_ASSETS.items()
    )


def read_cmc_provider_state(
    path: Path = CMC_PROVIDER_STATE_PATH,
    *,
    now: datetime | None = None,
    allow_fresh: bool = True,
) -> dict[str, Any]:
    try:
        if path.is_symlink():
            return invalid_cmc_provider_state("unsafe_file")
        metadata = path.stat()
        if not path.is_file() or metadata.st_size < 2 or metadata.st_size > CMC_PROVIDER_STATE_MAX_BYTES:
            return invalid_cmc_provider_state("unsafe_file")
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        return invalid_cmc_provider_state("unavailable")
    return normalize_cmc_provider_state(payload, now=now, allow_fresh=allow_fresh)


def fetch_gold_price() -> dict[str, Any]:
    key = os.environ.get("FRED_API_KEY")
    if not key:
        raise RuntimeError("FRED_API_KEY is not configured")
    payload = fetch_json(
        FRED_OBSERVATIONS_URL,
        allowed_origins=FRED_ALLOWED_ORIGINS,
        params={
            "series_id": GOLD_SERIES_ID,
            "api_key": key,
            "file_type": "json",
            "sort_order": "desc",
            "limit": "8",
        },
    )
    observations = [
        row for row in payload.get("observations", [])
        if row.get("value") not in {None, "."} and finite_number(row.get("value")) is not None
    ]
    if not observations:
        raise RuntimeError("FRED gold observations are unavailable")
    latest = observations[0]
    previous_row = observations[1] if len(observations) > 1 else None
    value = finite_number(latest.get("value"))
    previous = finite_number(previous_row.get("value")) if previous_row else None
    return metric(
        "GOLD_PRICE_PROXY",
        "Gold price proxy",
        value,
        "index",
        "FRED / Credit Suisse NASDAQ Gold FLOWS103 Price Index",
        "https://fred.stlouisfed.org/series/NASDAQQGLDI",
        latest.get("date"),
        pct_change(previous, value),
        previous,
    )


def fallback_metric(existing: dict[str, Any] | None, metric_id: str, failure: str) -> dict[str, Any]:
    cached = cached_metric(existing, metric_id)
    if cached and finite_number(cached.get("value")) is not None:
        return {
            **cached,
            "fetchedAt": cached.get("fetchedAt") or (existing.get("timestamps") or {}).get("fetchedAt") or existing.get("generatedAt"),
            "quality": "last-known-good",
            "failure": failure,
        }
    defaults = {
        "BTC_MARKET_CAP": ("BTC market cap", "USD", "CoinMarketCap normalized provider state", CMC_SOURCE_URL),
        "CRYPTO_MARKET_CAP": ("Total crypto market cap", "USD", "CoinMarketCap normalized provider state", CMC_SOURCE_URL),
        "GOLD_PRICE_PROXY": ("Gold price proxy", "index", "FRED / Credit Suisse NASDAQ Gold FLOWS103 Price Index", "https://fred.stlouisfed.org/series/NASDAQQGLDI"),
    }
    label, unit, source_label, source_url = defaults[metric_id]
    return {
        **metric(metric_id, label, None, unit, source_label, source_url, None, quality="unavailable"),
        "failure": failure,
    }


def source_is_eligible_for_run(source_policy_id: str, data_use_scope: str) -> bool:
    return source_is_eligible(source_policy_id, scope=data_use_scope, environment=os.environ)


def main() -> int:
    for key in DENIED_CONSUMER_ENV_KEYS:
        os.environ.pop(key, None)
    load_env_file(APP_ROOT / ".env.local")
    load_env_file(WORKSPACE_ROOT / ".env.local")

    existing = read_json(OUTPUT_PATH)
    slow_equity = read_json(SLOW_EQUITY_PATH) or {}
    data_use_scope = DATA_USE_SCOPE
    failures: list[str] = []
    metrics: list[dict[str, Any]] = []
    cmc_collection_requested = os.environ.get("CYCLELENS_COLLECT_CMC") == "true"
    cmc_eligible = source_is_eligible_for_run("coinmarketcap", data_use_scope)
    cmc_state = (
        read_cmc_provider_state(allow_fresh=cmc_collection_requested)
        if cmc_eligible and data_use_scope == "owner_private"
        else invalid_cmc_provider_state("scope_denied")
    )
    cmc_current_available = cmc_current_is_available(cmc_state)
    for metric_id in ("BTC_MARKET_CAP", "CRYPTO_MARKET_CAP"):
        provider_metric = cmc_state["metrics"].get(metric_id)
        if provider_metric is not None:
            metrics.append(provider_metric)
            if not cmc_state["fresh"]:
                message = "CoinMarketCap provider state is last-known-good; this collector made no CMC request"
                metrics[-1]["failure"] = message
                failures.append(f"{metric_id}: {message}")
        else:
            message = f"CoinMarketCap provider state unavailable ({cmc_state['reason']})"
            failures.append(f"{metric_id}: {message}")
            metrics.append(fallback_metric(existing, metric_id, message))

    gold_metric_id = "GOLD_PRICE_PROXY"
    if not source_is_eligible_for_run("fred-third-party", data_use_scope):
        message = f"fred-third-party is not eligible for {data_use_scope}"
        failures.append(f"{gold_metric_id}: {message}")
        metrics.append(fallback_metric(existing, gold_metric_id, message))
    else:
        try:
            fresh_metric = fetch_gold_price()
            fresh_metric["fetchedAt"] = iso_now()
            metrics.append(fresh_metric)
        except Exception as exc:  # noqa: BLE001 - provider failures are reported without secrets.
            message = safe_error_message(exc)
            failures.append(f"{gold_metric_id}: {message}")
            metrics.append(fallback_metric(existing, gold_metric_id, message))

    transformed_at = iso_now()
    fresh_metric_ids = sorted(item["id"] for item in metrics if item.get("quality") == "fresh")
    required_metric_ids = sorted(["BTC_MARKET_CAP", "CRYPTO_MARKET_CAP", "GOLD_PRICE_PROXY"])
    required_fresh_metric_ids = ["GOLD_PRICE_PROXY"]
    fresh_metric_count = len(fresh_metric_ids)
    cmc_state_mode = cmc_state.get("mode") or "missing"
    cmc_requested_but_unavailable = cmc_collection_requested and (
        not cmc_current_available
        or cmc_state_mode not in CMC_PROVIDER_STATE_ACTIVE_MODES
    )
    if (
        os.environ.get("CYCLELENS_REQUIRE_FRESH_OWNER_RELEASE") == "1"
        and (
            not all(metric_id in fresh_metric_ids for metric_id in required_fresh_metric_ids)
            or cmc_requested_but_unavailable
        )
    ):
        raise RuntimeError("The required non-CMC fast-equity metric did not refresh; refusing to replace the owner release")
    if data_use_scope == "owner_private" and fresh_metric_count == 0:
        raise RuntimeError("No reviewed fast-equity provider refreshed; refusing to replace the owner release")
    output = {
        "version": 1,
        "page": "equity-fast",
        "dataUseScope": data_use_scope,
        "generatedAt": transformed_at,
        "timestamps": {
            "observedAt": oldest_timestamp([item.get("asOf") for item in metrics if item.get("value") is not None]),
            "fetchedAt": oldest_timestamp([item.get("fetchedAt") for item in metrics if item.get("value") is not None]),
            "transformedAt": transformed_at,
        },
        "refreshCadence": REFRESH_CADENCE,
        "baseDataset": {
            "file": "equity-weekly.json",
            "timestamps": slow_equity.get("timestamps") or {"transformedAt": slow_equity.get("generatedAt")},
        },
        "methodology": (
            "Fast indicators are generated separately from the slower equity calendar cache. "
            "CMC market capitalization is consumed only from a bounded owner-private normalized provider-state file; this collector has no CMC credential or CMC network path. FRED supplies a gold price proxy index because the old LBMA gold fix series is not available in the current FRED API. "
            "The frontend reads this static derived JSON and never receives provider credentials."
        ),
        "metrics": metrics,
        "sources": {
            "CoinMarketCap": "https://coinmarketcap.com/api/documentation/v1/",
            "FRED": "https://fred.stlouisfed.org/docs/api/fred/",
            "Gold proxy": "https://fred.stlouisfed.org/series/NASDAQQGLDI",
        },
        "failures": failures,
        "refreshSummary": {
            "freshMetricCount": fresh_metric_count,
            "requiredMetricIds": required_metric_ids,
            "requiredFreshMetricIds": required_fresh_metric_ids,
            "freshMetricIds": fresh_metric_ids,
            "cmcCollectionRequested": cmc_collection_requested,
            "cmcCurrentAvailable": cmc_current_available,
            "cmcCurrentRefreshed": cmc_collection_requested and cmc_state["fresh"],
            "cmcStateMode": cmc_state_mode,
        },
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "status": "updated",
        "outputPath": str(OUTPUT_PATH),
        "metrics": len(metrics),
        "failures": len(failures),
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
