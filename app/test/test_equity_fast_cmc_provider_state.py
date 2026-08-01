from __future__ import annotations

import os
import importlib.util
import sys
import unittest
from datetime import UTC, datetime
from pathlib import Path


os.environ.setdefault("CYCLELENS_DATA_USE_SCOPE", "owner_private")
os.environ.setdefault("CYCLELENS_OWNER_PRIVATE_USE_APPROVED", "1")

SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

MODULE_SPEC = importlib.util.spec_from_file_location(
    "update_equity_fast_data",
    SCRIPTS_DIR / "update-equity-fast-data.py",
)
if MODULE_SPEC is None or MODULE_SPEC.loader is None:
    raise RuntimeError("Could not load update-equity-fast-data.py")
UPDATE_EQUITY_FAST = importlib.util.module_from_spec(MODULE_SPEC)
MODULE_SPEC.loader.exec_module(UPDATE_EQUITY_FAST)
normalize_cmc_provider_state = UPDATE_EQUITY_FAST.normalize_cmc_provider_state
cmc_current_is_available = UPDATE_EQUITY_FAST.cmc_current_is_available


NOW = datetime(2026, 7, 31, 12, tzinfo=UTC)


def cmc_asset(symbol: str, asset_id: int, market_cap: float) -> dict:
    return {
        "id": asset_id,
        "symbol": symbol,
        "priceUsd": 1.0 if symbol in {"USDT", "USDC"} else 100.0,
        "marketCapUsd": market_cap,
        "percentChange24h": 1.25,
        "observedAt": "2026-07-31T11:58:00Z",
    }


def provider_state() -> dict:
    return {
        "version": 1,
        "provider": "coinmarketcap",
        "dataUseScope": "owner_private",
        "updatedAt": "2026-07-31T11:59:00Z",
        "current": {
            "fetchedAt": "2026-07-31T11:59:00Z",
            "global": {
                "totalMarketCapUsd": 2_500_000.0,
                "totalMarketCapYesterdayUsd": 2_400_000.0,
                "totalMarketCapChangePct24h": 4.166,
                "observedAt": "2026-07-31T11:58:00Z",
            },
            "assets": {
                "BTC": cmc_asset("BTC", 1, 1_400_000.0),
                "ETH": cmc_asset("ETH", 1027, 500_000.0),
                "USDT": cmc_asset("USDT", 825, 180_000.0),
                "USDC": cmc_asset("USDC", 3408, 75_000.0),
                "HYPE": cmc_asset("HYPE", 32196, 12_000.0),
                "BNB": cmc_asset("BNB", 1839, 95_000.0),
            },
        },
        "history": {},
        "watermarks": {},
        "budget": {},
        "refresh": {
            "mode": "refreshed",
            "networkRequests": 2,
            "creditCount": 2,
            "currentRefreshed": True,
            "historyRefreshed": False,
        },
    }


class EquityFastCmcProviderStateTests(unittest.TestCase):
    def test_current_state_maps_to_fresh_metrics(self) -> None:
        normalized = normalize_cmc_provider_state(provider_state(), now=NOW)
        self.assertTrue(normalized["valid"])
        self.assertTrue(normalized["fresh"])
        self.assertTrue(cmc_current_is_available(normalized))
        self.assertEqual(normalized["metrics"]["BTC_MARKET_CAP"]["value"], 1_400_000.0)
        self.assertEqual(normalized["metrics"]["CRYPTO_MARKET_CAP"]["previous"], 2_400_000.0)
        self.assertEqual(normalized["metrics"]["BTC_MARKET_CAP"]["quality"], "fresh")

    def test_stale_state_is_never_marked_fresh(self) -> None:
        payload = provider_state()
        payload["current"]["fetchedAt"] = "2026-07-31T09:00:00Z"
        normalized = normalize_cmc_provider_state(payload, now=NOW)
        self.assertTrue(normalized["valid"])
        self.assertFalse(normalized["fresh"])
        self.assertEqual(normalized["metrics"]["BTC_MARKET_CAP"]["quality"], "last-known-good")
        self.assertIn("last-known-good", normalized["metrics"]["BTC_MARKET_CAP"]["sourceLabel"])

    def test_wrong_scope_non_finite_and_future_values_fail_closed(self) -> None:
        wrong_scope = provider_state()
        wrong_scope["dataUseScope"] = "public"
        wrong_scope_state = normalize_cmc_provider_state(wrong_scope, now=NOW)
        self.assertFalse(wrong_scope_state["valid"])
        self.assertEqual(wrong_scope_state["mode"], "missing")

        non_finite = provider_state()
        non_finite["current"]["assets"]["BTC"]["marketCapUsd"] = "1400000"
        self.assertFalse(normalize_cmc_provider_state(non_finite, now=NOW)["valid"])

        future = provider_state()
        future["current"]["global"]["observedAt"] = "2026-08-01T00:00:00Z"
        self.assertFalse(normalize_cmc_provider_state(future, now=NOW)["valid"])

    def test_nullable_fields_are_valid_and_incomplete_or_disabled_current_is_missing(self) -> None:
        nullable = provider_state()
        nullable["current"]["global"]["totalMarketCapYesterdayUsd"] = None
        nullable["current"]["global"]["totalMarketCapChangePct24h"] = None
        nullable["current"]["assets"]["BTC"]["percentChange24h"] = None
        nullable_state = normalize_cmc_provider_state(nullable, now=NOW)
        self.assertTrue(nullable_state["valid"])
        self.assertIsNone(nullable_state["metrics"]["CRYPTO_MARKET_CAP"]["previous"])
        self.assertTrue(cmc_current_is_available(nullable_state))

        disabled = provider_state()
        disabled["current"] = None
        disabled["refresh"]["mode"] = "disabled"
        disabled_state = normalize_cmc_provider_state(disabled, now=NOW)
        self.assertFalse(disabled_state["valid"])
        self.assertEqual(disabled_state["mode"], "missing")
        self.assertFalse(cmc_current_is_available(disabled_state))

        wrong_id = provider_state()
        wrong_id["current"]["assets"]["BTC"]["id"] = 1027
        self.assertEqual(normalize_cmc_provider_state(wrong_id, now=NOW)["mode"], "missing")

        unsupported_mode = provider_state()
        unsupported_mode["refresh"]["mode"] = "current"
        self.assertEqual(normalize_cmc_provider_state(unsupported_mode, now=NOW)["mode"], "missing")

        cadence = provider_state()
        cadence["refresh"]["mode"] = "cadence_guard"
        cadence["refresh"]["currentRefreshed"] = False
        cadence_state = normalize_cmc_provider_state(cadence, now=NOW)
        self.assertFalse(cadence_state["fresh"])
        self.assertTrue(cmc_current_is_available(cadence_state))

    def test_script_has_no_direct_cmc_credential_or_network_path(self) -> None:
        source = (SCRIPTS_DIR / "update-equity-fast-data.py").read_text(encoding="utf-8")
        self.assertEqual(source.count("CMC_PRO_API_KEY"), 1)
        self.assertIn("DENIED_CONSUMER_ENV_KEYS", source)
        self.assertIn("os.environ.pop(key, None)", source)
        for forbidden in ("X-CMC", "pro-api.coinmarketcap.com", "fetch_btc_market_cap", "fetch_crypto_market_cap"):
            self.assertNotIn(forbidden, source)
        self.assertIn("provider-state", source)
        self.assertIn("coinmarketcap.json", source)
        self.assertIn('os.environ.get("CYCLELENS_COLLECT_CMC") == "true"', source)


if __name__ == "__main__":
    unittest.main()
