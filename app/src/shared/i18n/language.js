import { readLanguagePreference } from "../../localPreferences.js";
import { normalizedLanguage } from "./pageIdentity.js";

export const SUPPORTED_LANGUAGES = Object.freeze(["zh", "en"]);

export function languageCode(value) {
  return normalizedLanguage(value);
}

export function languageFromTranslation(translation) {
  return languageCode(translation?.htmlLang);
}

export function getInitialLanguage(options) {
  return readLanguagePreference(options);
}
