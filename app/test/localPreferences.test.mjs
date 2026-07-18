import assert from "node:assert/strict";
import test from "node:test";

import {
  LEGACY_PREFERENCE_KEYS,
  PREFERENCE_KEYS,
  readLanguagePreference,
  readShowCryptoPreference,
  writeLanguagePreference,
  writeShowCryptoPreference,
} from "../src/localPreferences.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

test("legacy preferences are read once and future writes use the CycleLens namespace", () => {
  const storage = memoryStorage({
    [LEGACY_PREFERENCE_KEYS.language]: "en",
    [LEGACY_PREFERENCE_KEYS.hideCrypto]: "1",
  });
  assert.equal(readLanguagePreference({ storage }), "en");
  assert.equal(readShowCryptoPreference({ storage }), false);
  assert.equal(writeLanguagePreference("zh", { storage }), true);
  assert.equal(writeShowCryptoPreference(true, { storage }), true);
  assert.equal(storage.values.get(PREFERENCE_KEYS.language), "zh");
  assert.equal(storage.values.get(PREFERENCE_KEYS.hideCrypto), "0");
  assert.equal(storage.values.get(LEGACY_PREFERENCE_KEYS.language), "en");
  assert.equal(storage.values.get(LEGACY_PREFERENCE_KEYS.hideCrypto), "1");
});

test("compatibility reads do not eagerly copy or delete the legacy value", () => {
  const storage = memoryStorage({ [LEGACY_PREFERENCE_KEYS.language]: "en" });
  const language = readLanguagePreference({ storage });

  assert.equal(language, "en");
  assert.equal(storage.values.get(LEGACY_PREFERENCE_KEYS.language), "en");
  assert.equal(storage.values.has(PREFERENCE_KEYS.language), false);
});

test("a valid primary preference wins over its legacy fallback", () => {
  const storage = memoryStorage({
    [PREFERENCE_KEYS.language]: "zh",
    [LEGACY_PREFERENCE_KEYS.language]: "en",
  });
  assert.equal(readLanguagePreference({ storage }), "zh");
});

test("invalid, unavailable, or rejected storage safely falls back", () => {
  const invalid = memoryStorage({ [LEGACY_PREFERENCE_KEYS.language]: "de" });
  assert.equal(readLanguagePreference({ storage: invalid }), "zh");
  assert.equal(readShowCryptoPreference({ storage: memoryStorage() }), true);
  assert.equal(writeLanguagePreference("de", { storage: invalid }), false);

  const unavailable = {
    getItem() {
      throw new Error("storage-disabled");
    },
    setItem() {
      throw new Error("storage-disabled");
    },
  };
  assert.equal(readLanguagePreference({ storage: unavailable }), "zh");
  assert.equal(readShowCryptoPreference({ storage: unavailable }), true);
  assert.equal(writeLanguagePreference("en", { storage: unavailable }), false);
  assert.equal(writeShowCryptoPreference(false, { storage: unavailable }), false);
});

test("a browser that blocks the localStorage getter also falls back safely", () => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    get() {
      throw new Error("storage-blocked");
    },
  });
  try {
    assert.equal(readLanguagePreference(), "zh");
    assert.equal(readShowCryptoPreference(), true);
    assert.equal(writeLanguagePreference("en"), false);
    assert.equal(writeShowCryptoPreference(false), false);
  } finally {
    delete globalThis.window;
  }
});
