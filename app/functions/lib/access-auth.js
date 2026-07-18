const MAX_ACCESS_TOKEN_BYTES = 16 * 1024;
const MAX_JWKS_BYTES = 256 * 1024;

export class AccessValidationError extends Error {
  constructor(code) {
    super(code);
    this.name = "AccessValidationError";
    this.code = code;
  }
}

function requiredEnvironment(env, name) {
  const value = String(env?.[name] || "").trim();
  if (!value) throw new AccessValidationError("access_not_configured");
  return value;
}

function teamDomain(env) {
  let url;
  try {
    url = new URL(requiredEnvironment(env, "CF_ACCESS_TEAM_DOMAIN"));
  } catch {
    throw new AccessValidationError("access_team_domain_invalid");
  }
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash
    || !url.hostname.endsWith(".cloudflareaccess.com")
  ) {
    throw new AccessValidationError("access_team_domain_invalid");
  }
  return url.origin;
}

function base64UrlBytes(value) {
  const encoded = String(value || "");
  if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
    throw new AccessValidationError("access_token_encoding_invalid");
  }
  const normalized = encoded.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  let binary;
  try {
    binary = atob(padded);
  } catch {
    throw new AccessValidationError("access_token_encoding_invalid");
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function limitedResponseText(response, maximumBytes) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new AccessValidationError("access_keys_too_large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function base64UrlJson(value) {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(base64UrlBytes(value)));
  } catch (error) {
    if (error instanceof AccessValidationError) throw error;
    throw new AccessValidationError("access_token_json_invalid");
  }
}

async function fetchSigningKey(team, keyId, fetchImpl) {
  const response = await fetchImpl(`${team}/cdn-cgi/access/certs`, {
    headers: { accept: "application/json" },
    cf: { cacheEverything: true, cacheTtl: 3600 },
  });
  if (!response.ok) throw new AccessValidationError("access_keys_unavailable");
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JWKS_BYTES) {
    throw new AccessValidationError("access_keys_too_large");
  }
  let text;
  try {
    text = await limitedResponseText(response, MAX_JWKS_BYTES);
  } catch (error) {
    if (error instanceof AccessValidationError) throw error;
    throw new AccessValidationError("access_keys_invalid");
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new AccessValidationError("access_keys_invalid");
  }
  const keys = Array.isArray(payload?.keys) ? payload.keys.slice(0, 20) : [];
  const key = keys.find((candidate) => (
    candidate?.kid === keyId
    && candidate?.kty === "RSA"
    && (!candidate.alg || candidate.alg === "RS256")
  ));
  if (!key) throw new AccessValidationError("access_signing_key_missing");
  return key;
}

function expectedAudience(payload, audience) {
  const audiences = Array.isArray(payload?.aud) ? payload.aud : [payload?.aud];
  return audiences.includes(audience);
}

async function auditActor(subject) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`cyclelens:${subject}`));
  const bytes = new Uint8Array(digest).slice(0, 12);
  const identifier = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `cf-access:${identifier}`;
}

export async function validateAccessRequest(request, env, { fetchImpl = fetch, now = Date.now() } = {}) {
  const token = String(request?.headers?.get("Cf-Access-Jwt-Assertion") || "").trim();
  if (!token) throw new AccessValidationError("access_token_missing");
  if (new TextEncoder().encode(token).byteLength > MAX_ACCESS_TOKEN_BYTES) {
    throw new AccessValidationError("access_token_too_large");
  }
  const segments = token.split(".");
  if (segments.length !== 3) throw new AccessValidationError("access_token_invalid");
  const header = base64UrlJson(segments[0]);
  const payload = base64UrlJson(segments[1]);
  if (header?.alg !== "RS256" || typeof header?.kid !== "string") {
    throw new AccessValidationError("access_algorithm_invalid");
  }
  const team = teamDomain(env);
  const audience = requiredEnvironment(env, "CF_ACCESS_AUD");
  const key = await fetchSigningKey(team, header.kid, fetchImpl);
  let cryptoKey;
  try {
    cryptoKey = await crypto.subtle.importKey(
      "jwk",
      key,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
  } catch {
    throw new AccessValidationError("access_signing_key_invalid");
  }
  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    base64UrlBytes(segments[2]),
    new TextEncoder().encode(`${segments[0]}.${segments[1]}`),
  );
  if (!verified) throw new AccessValidationError("access_signature_invalid");
  const currentSeconds = Math.floor(now / 1000);
  if (!Number.isFinite(payload?.exp) || payload.exp <= currentSeconds) throw new AccessValidationError("access_token_expired");
  if (payload?.nbf != null && !Number.isFinite(payload.nbf)) throw new AccessValidationError("access_token_not_yet_valid");
  if (Number.isFinite(payload?.nbf) && payload.nbf > currentSeconds + 30) throw new AccessValidationError("access_token_not_yet_valid");
  if (String(payload?.iss || "").replace(/\/$/, "") !== team) throw new AccessValidationError("access_issuer_invalid");
  if (!expectedAudience(payload, audience)) throw new AccessValidationError("access_audience_invalid");
  const subject = String(payload?.sub || "").trim();
  if (!subject) throw new AccessValidationError("access_subject_missing");
  return {
    actor: await auditActor(subject),
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  };
}
