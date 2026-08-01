const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export class SecureFetchError extends Error {
  constructor(code) {
    super(code);
    this.name = "SecureFetchError";
    this.code = code;
  }
}

export function allowedProviderUrl(value, allowedOrigins) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new SecureFetchError("provider_url_invalid");
  }
  const origins = new Set((allowedOrigins || []).map((origin) => new URL(origin).origin));
  if (parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || !origins.has(parsed.origin)) {
    throw new SecureFetchError("provider_destination_not_allowed");
  }
  return parsed;
}

async function boundedResponseBytes(response, maximumBytes) {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength != null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > maximumBytes) {
      throw new SecureFetchError("provider_response_too_large");
    }
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new SecureFetchError("provider_response_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function fetchTextBounded(url, options = {}) {
  const {
    allowedOrigins,
    fetchImpl = fetch,
    headers,
    maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    ...requestOptions
  } = options;
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1) {
    throw new SecureFetchError("provider_response_limit_invalid");
  }
  const destination = allowedProviderUrl(url, allowedOrigins);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(destination.toString(), {
      ...requestOptions,
      headers,
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) throw new SecureFetchError(`provider_http_${response.status}`);
    const bytes = await boundedResponseBytes(response, maxResponseBytes);
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new SecureFetchError("provider_response_invalid_utf8");
    }
  } catch (error) {
    if (error instanceof SecureFetchError) throw error;
    throw new SecureFetchError("provider_request_failed");
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchJsonBounded(url, options = {}) {
  const text = await fetchTextBounded(url, {
    ...options,
    headers: {
      accept: "application/json",
      ...(options.headers || {}),
    },
  });
  try {
    return JSON.parse(text);
  } catch {
    throw new SecureFetchError("provider_response_invalid_json");
  }
}
