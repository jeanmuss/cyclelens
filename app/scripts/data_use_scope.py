"""Shared fail-closed data-use scope helpers for backend collectors."""

from __future__ import annotations

import os
from collections.abc import Mapping, Sequence
from pathlib import Path

PUBLIC_SCOPE = "public"
OWNER_PRIVATE_SCOPE = "owner_private"
DATA_USE_SCOPES = frozenset({PUBLIC_SCOPE, OWNER_PRIVATE_SCOPE})

# These source ids have a repository review and use official, documented public,
# or licensed transports. Legacy unofficial adapters are intentionally absent.
REVIEWED_NON_BLOCKED_SOURCE_IDS = frozenset({
    "coinmarketcap",
    "defillama",
    "sosovalue",
    "blockbeats",
    "sec-edgar",
    "strategy-disclosures",
    "japan-mof",
    "fred-government",
    "fred-third-party",
    "federal-reserve",
    "official-market-calendars",
    "public-crypto-market-apis",
    "alpaca",
    "adp",
})

PUBLIC_SOURCE_APPROVALS: dict[str, tuple[str | None, bool]] = {
    "coinmarketcap": ("CMC_REDISTRIBUTION_APPROVED", False),
    "defillama": ("DEFILLAMA_REDISTRIBUTION_APPROVED", False),
    "sosovalue": ("SOSOVALUE_REDISTRIBUTION_APPROVED", False),
    "blockbeats": ("BLOCKBEATS_REDISTRIBUTION_APPROVED", False),
    "sec-edgar": (None, True),
    "strategy-disclosures": (None, True),
    "japan-mof": (None, True),
    "fred-government": (None, True),
    "fred-third-party": ("FRED_THIRD_PARTY_SERIES_APPROVED", False),
    "federal-reserve": (None, True),
    "official-market-calendars": (None, True),
    "public-crypto-market-apis": ("PUBLIC_CRYPTO_MARKET_DATA_APPROVED", False),
    "alpaca": ("ALPACA_REDISTRIBUTION_APPROVED", False),
    "adp": ("ADP_DATA_DISPLAY_APPROVED", False),
}


def normalize_data_use_scope(value: object, fallback: str = PUBLIC_SCOPE) -> str:
    candidate = str(value or "").strip().lower()
    if not candidate:
        return fallback
    if candidate not in DATA_USE_SCOPES:
        raise ValueError(f"Unsupported data-use scope: {candidate}")
    return candidate


def data_use_scope_from_environment(
    environment: Mapping[str, str] | None = None,
    argv: Sequence[str] | None = None,
) -> str:
    current_environment = environment if environment is not None else os.environ
    arguments_list = [str(value) for value in (argv or [])]
    argument_value = next(
        (value.split("=", 1)[1] for value in arguments_list if value.startswith("--scope=")),
        None,
    )
    if argument_value is None and "--scope" in arguments_list:
        scope_index = arguments_list.index("--scope")
        argument_value = arguments_list[scope_index + 1] if scope_index + 1 < len(arguments_list) else None
    requested_scope = argument_value or current_environment.get("CYCLELENS_DATA_USE_SCOPE")
    if not str(requested_scope or "").strip():
        raise ValueError(
            "Data-use scope must be explicit via --scope or CYCLELENS_DATA_USE_SCOPE"
        )
    return normalize_data_use_scope(requested_scope)


def data_directory_for_scope(app_root: Path, scope: str) -> Path:
    normalized_scope = normalize_data_use_scope(scope)
    if normalized_scope == OWNER_PRIVATE_SCOPE:
        return app_root / "data" / "private" / "raw"
    return app_root / "public" / "data"


def manual_macro_events_path_for_scope(app_root: Path, scope: str) -> Path:
    normalized_scope = normalize_data_use_scope(scope)
    if normalized_scope == OWNER_PRIVATE_SCOPE:
        return app_root / "data" / "private" / "manual-macro-events.json"
    return app_root / "data" / "manual-macro-events.json"


def cache_root_for_scope(workspace_root: Path, scope: str) -> Path:
    normalized_scope = normalize_data_use_scope(scope)
    if normalized_scope == OWNER_PRIVATE_SCOPE:
        return workspace_root / "tmp" / "owner-private"
    return workspace_root / "tmp"


def source_is_eligible(
    source_policy_id: str,
    *,
    scope: str,
    environment: Mapping[str, str] | None = None,
) -> bool:
    current_environment = environment if environment is not None else os.environ
    normalized_scope = normalize_data_use_scope(scope)
    if source_policy_id not in REVIEWED_NON_BLOCKED_SOURCE_IDS:
        return False
    if normalized_scope == OWNER_PRIVATE_SCOPE:
        return current_environment.get("CYCLELENS_OWNER_PRIVATE_USE_APPROVED") == "1"
    approval_variable, approved_without_gate = PUBLIC_SOURCE_APPROVALS[source_policy_id]
    if approved_without_gate:
        return True
    return bool(approval_variable and current_environment.get(approval_variable) == "1")


def source_use_allowed(
    public_variable: str | None,
    *,
    scope: str,
    owner_eligible: bool = True,
    public_without_gate: bool = False,
    environment: Mapping[str, str] | None = None,
) -> bool:
    """Evaluate a collector-local source gate without weakening either scope."""
    current_environment = environment if environment is not None else os.environ
    normalized_scope = normalize_data_use_scope(scope)
    if normalized_scope == OWNER_PRIVATE_SCOPE:
        return (
            owner_eligible
            and current_environment.get("CYCLELENS_OWNER_PRIVATE_USE_APPROVED") == "1"
        )
    if public_without_gate:
        return True
    return bool(public_variable and current_environment.get(public_variable) == "1")
