function configuredOrigins(env) {
  return new Set(String(env?.CYCLELENS_ADMIN_ORIGINS || "")
    .split(",")
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean));
}

function configuredSuffixes(env) {
  return String(env?.CYCLELENS_ADMIN_HOST_SUFFIXES || "")
    .split(",")
    .map((value) => value.trim().replace(/^\./, "").toLowerCase())
    .filter((value) => value.endsWith(".pages.dev") && value.split(".").length >= 3);
}

function originAllowed(origin, env) {
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/") return false;
  if (configuredOrigins(env).has(url.origin)) return true;
  return configuredSuffixes(env).some((suffix) => url.hostname === suffix || url.hostname.endsWith(`.${suffix}`));
}

export function validateAdminOrigin(request, env, { requireHeader = false } = {}) {
  const requestOrigin = new URL(request.url).origin;
  if (!originAllowed(requestOrigin, env)) return false;
  const headerOrigin = String(request.headers.get("origin") || "").replace(/\/$/, "");
  if (requireHeader && !headerOrigin) return false;
  return !headerOrigin || (headerOrigin === requestOrigin && originAllowed(headerOrigin, env));
}

export async function readBoundedJson(request, maximumBytes) {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) throw new Error("request_body_too_large");
  if (!String(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) {
    throw new Error("content_type_must_be_json");
  }
  if (!request.body) throw new Error("request_body_required");
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new Error("request_body_too_large");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    throw new Error("request_body_invalid_json");
  }
}

export function jsonResponse(status, payload, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}
