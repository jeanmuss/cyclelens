"""Bounded, no-redirect HTTP transport for reviewed provider origins."""

from __future__ import annotations

import json
import time
from collections.abc import Collection, Mapping
from typing import Any
from urllib.parse import urlsplit

import requests

DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024
DEFAULT_TIMEOUT = (10, 20)
DEFAULT_TOTAL_TIMEOUT_SECONDS = 45


class SecureHttpError(RuntimeError):
    """A provider error whose message cannot disclose a URL or credential."""


def _origin(value: str) -> str:
    parsed = urlsplit(value)
    try:
        port = parsed.port
    except ValueError:
        raise SecureHttpError("provider_destination_not_allowed") from None
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or port not in (None, 443)
    ):
        raise SecureHttpError("provider_destination_not_allowed")
    return f"https://{parsed.hostname.lower()}"


def validate_provider_url(url: str, allowed_origins: Collection[str]) -> str:
    destination_origin = _origin(url)
    reviewed_origins = {_origin(value) for value in allowed_origins}
    if destination_origin not in reviewed_origins:
        raise SecureHttpError("provider_destination_not_allowed")
    return url


def get_bytes_bounded(
    url: str,
    *,
    allowed_origins: Collection[str],
    params: Mapping[str, object] | None = None,
    headers: Mapping[str, str] | None = None,
    maximum_bytes: int = DEFAULT_MAX_RESPONSE_BYTES,
    timeout: tuple[int, int] = DEFAULT_TIMEOUT,
    total_timeout_seconds: int = DEFAULT_TOTAL_TIMEOUT_SECONDS,
) -> bytes:
    validate_provider_url(url, allowed_origins)
    if not isinstance(maximum_bytes, int) or maximum_bytes < 1:
        raise SecureHttpError("provider_response_limit_invalid")
    if not isinstance(total_timeout_seconds, int) or total_timeout_seconds < 1:
        raise SecureHttpError("provider_timeout_invalid")
    started_at = time.monotonic()
    response = None
    try:
        response = requests.get(
            url,
            params=params,
            headers=dict(headers or {}),
            timeout=timeout,
            allow_redirects=False,
            stream=True,
        )
        if 300 <= response.status_code < 400:
            raise SecureHttpError("provider_redirect_rejected")
        if not response.ok:
            raise SecureHttpError(f"provider_http_{response.status_code}")
        declared_length = response.headers.get("content-length")
        if declared_length is not None:
            try:
                parsed_length = int(declared_length)
            except ValueError:
                raise SecureHttpError("provider_content_length_invalid") from None
            if parsed_length < 0 or parsed_length > maximum_bytes:
                raise SecureHttpError("provider_response_too_large")
        chunks: list[bytes] = []
        total = 0
        for chunk in response.iter_content(chunk_size=64 * 1024):
            if time.monotonic() - started_at > total_timeout_seconds:
                raise SecureHttpError("provider_request_timed_out")
            if not chunk:
                continue
            total += len(chunk)
            if total > maximum_bytes:
                raise SecureHttpError("provider_response_too_large")
            chunks.append(chunk)
        return b"".join(chunks)
    except SecureHttpError:
        raise
    except requests.RequestException:
        # Requests exceptions can embed the fully prepared URL, including query
        # credentials. Suppress the cause so an uncaught CI traceback remains safe.
        raise SecureHttpError("provider_request_failed") from None
    finally:
        if response is not None:
            response.close()


def get_text_bounded(
    url: str,
    *,
    allowed_origins: Collection[str],
    params: Mapping[str, object] | None = None,
    headers: Mapping[str, str] | None = None,
    maximum_bytes: int = DEFAULT_MAX_RESPONSE_BYTES,
    total_timeout_seconds: int = DEFAULT_TOTAL_TIMEOUT_SECONDS,
) -> str:
    payload = get_bytes_bounded(
        url,
        allowed_origins=allowed_origins,
        params=params,
        headers=headers,
        maximum_bytes=maximum_bytes,
        total_timeout_seconds=total_timeout_seconds,
    )
    try:
        return payload.decode("utf-8-sig", errors="strict")
    except UnicodeDecodeError:
        raise SecureHttpError("provider_response_invalid_utf8") from None


def get_json_bounded(
    url: str,
    *,
    allowed_origins: Collection[str],
    params: Mapping[str, object] | None = None,
    headers: Mapping[str, str] | None = None,
    maximum_bytes: int = DEFAULT_MAX_RESPONSE_BYTES,
    total_timeout_seconds: int = DEFAULT_TOTAL_TIMEOUT_SECONDS,
) -> dict[str, Any]:
    text = get_text_bounded(
        url,
        allowed_origins=allowed_origins,
        params=params,
        headers=headers,
        maximum_bytes=maximum_bytes,
        total_timeout_seconds=total_timeout_seconds,
    )
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        raise SecureHttpError("provider_response_invalid_json") from None
    if not isinstance(payload, dict):
        raise SecureHttpError("provider_response_not_object")
    return payload
