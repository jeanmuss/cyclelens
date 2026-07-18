import { PRODUCT_CONFIG, productStorageKey } from "../product.config.mjs";

export const PREFERENCE_KEYS = Object.freeze({
  language: productStorageKey(PRODUCT_CONFIG.storageKeys.language),
  hideCrypto: productStorageKey(PRODUCT_CONFIG.storageKeys.marketClockHideCrypto),
  dashboardLayout: productStorageKey(PRODUCT_CONFIG.storageKeys.dashboardLayout),
});

export const LEGACY_PREFERENCE_KEYS = Object.freeze({
  language: PRODUCT_CONFIG.legacyStorageKeys.language,
  hideCrypto: PRODUCT_CONFIG.legacyStorageKeys.marketClockHideCrypto,
});

function browserStorage() {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function storedValue(storage, key) {
  if (!storage || !key) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

export function readPreference({ storage = browserStorage(), key, legacyKeys = [], parse, fallback }) {
  for (const candidate of [key, ...legacyKeys]) {
    const value = parse(storedValue(storage, candidate));
    if (value !== undefined) return value;
  }
  return fallback;
}

export function writePreference({ storage = browserStorage(), key, value }) {
  if (!storage || !key) return false;
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function readLanguagePreference({
  storage = browserStorage(),
  key = PREFERENCE_KEYS.language,
  legacyKeys = [LEGACY_PREFERENCE_KEYS.language],
} = {}) {
  return readPreference({
    storage,
    key,
    legacyKeys,
    parse: (value) => value === "en" || value === "zh" ? value : undefined,
    fallback: "zh",
  });
}

export function writeLanguagePreference(language, {
  storage = browserStorage(),
  key = PREFERENCE_KEYS.language,
} = {}) {
  if (language !== "en" && language !== "zh") return false;
  return writePreference({ storage, key, value: language });
}

export function readShowCryptoPreference({
  storage = browserStorage(),
  key = PREFERENCE_KEYS.hideCrypto,
  legacyKeys = [LEGACY_PREFERENCE_KEYS.hideCrypto],
} = {}) {
  return readPreference({
    storage,
    key,
    legacyKeys,
    parse: (value) => value == null ? undefined : value !== "1",
    fallback: true,
  });
}

export function writeShowCryptoPreference(showCrypto, {
  storage = browserStorage(),
  key = PREFERENCE_KEYS.hideCrypto,
} = {}) {
  return writePreference({ storage, key, value: showCrypto ? "0" : "1" });
}
