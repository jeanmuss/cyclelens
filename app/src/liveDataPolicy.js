const DEFAULT_POLL_INTERVAL_MS = 300_000;
const MIN_POLL_INTERVAL_MS = 30_000;
const MAX_POLL_INTERVAL_MS = 3_600_000;

export function initialLiveData(definitions) {
  return Object.fromEntries(definitions.map((definition) => [definition.id, null]));
}

export function normalizePollInterval(value, fallback = DEFAULT_POLL_INTERVAL_MS) {
  const interval = Number(value);
  if (!Number.isFinite(interval)) return fallback;
  return Math.min(MAX_POLL_INTERVAL_MS, Math.max(MIN_POLL_INTERVAL_MS, interval));
}

export function versionedDataUrl(url, version) {
  if (!version) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${encodeURIComponent(version)}`;
}

export function manifestVersion(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value) ? value : null;
}

export function manifestTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

export function manifestFreshness(entry, clientCheckedAt) {
  return {
    observedAt: manifestTimestamp(entry?.observedAt),
    fetchedAt: manifestTimestamp(entry?.fetchedAt),
    transformedAt: manifestTimestamp(entry?.transformedAt),
    deployedAt: manifestTimestamp(entry?.deployedAt),
    clientCheckedAt,
    timestampFallback: entry?.timestampFallback === "legacy-generatedAt" ? "legacy-generatedAt" : null,
  };
}
