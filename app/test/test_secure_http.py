from __future__ import annotations

import sys
import traceback
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import requests

SCRIPTS_DIRECTORY = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS_DIRECTORY))

from secure_http import SecureHttpError, get_bytes_bounded  # noqa: E402


class FakeResponse:
    def __init__(self, chunks: list[bytes], *, status_code: int = 200, headers: dict | None = None):
        self._chunks = chunks
        self.status_code = status_code
        self.ok = 200 <= status_code < 300
        self.headers = headers or {}
        self.closed = False

    def iter_content(self, chunk_size: int):
        del chunk_size
        yield from self._chunks

    def close(self):
        self.closed = True


class SecureHttpTests(unittest.TestCase):
    def test_rejects_unreviewed_origin_before_network_access(self):
        fetch = Mock()
        with patch("secure_http.requests.get", fetch):
            with self.assertRaisesRegex(SecureHttpError, "provider_destination_not_allowed"):
                get_bytes_bounded(
                    "https://api.stlouisfed.org.evil.example/fred",
                    allowed_origins={"https://api.stlouisfed.org"},
                )
        fetch.assert_not_called()

    def test_rejects_redirect_and_closes_response(self):
        response = FakeResponse([], status_code=302)
        with patch("secure_http.requests.get", return_value=response):
            with self.assertRaisesRegex(SecureHttpError, "provider_redirect_rejected"):
                get_bytes_bounded(
                    "https://api.stlouisfed.org/fred",
                    allowed_origins={"https://api.stlouisfed.org"},
                )
        self.assertTrue(response.closed)

    def test_enforces_streamed_body_limit(self):
        response = FakeResponse([b"abcd", b"efgh"])
        with patch("secure_http.requests.get", return_value=response):
            with self.assertRaisesRegex(SecureHttpError, "provider_response_too_large"):
                get_bytes_bounded(
                    "https://api.stlouisfed.org/fred",
                    allowed_origins={"https://api.stlouisfed.org"},
                    maximum_bytes=7,
                )
        self.assertTrue(response.closed)

    def test_traceback_does_not_retain_query_credentials(self):
        sentinel = "SENTINEL_FRED_KEY"
        cause = requests.RequestException(
            f"failed request https://api.stlouisfed.org/fred?api_key={sentinel}",
        )
        with patch("secure_http.requests.get", side_effect=cause):
            try:
                get_bytes_bounded(
                    "https://api.stlouisfed.org/fred",
                    allowed_origins={"https://api.stlouisfed.org"},
                    params={"api_key": sentinel},
                )
            except SecureHttpError as error:
                rendered = traceback.format_exc()
                self.assertEqual(str(error), "provider_request_failed")
                self.assertNotIn(sentinel, rendered)
                self.assertIsNone(error.__cause__)
            else:
                self.fail("expected a safe transport error")


if __name__ == "__main__":
    unittest.main()
