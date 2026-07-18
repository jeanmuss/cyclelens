import { useEffect, useState } from "react";

import { productPageTitle } from "../../product.config.mjs";
import { writeLanguagePreference } from "../localPreferences.js";
import { getInitialLanguage } from "../shared/i18n/language.js";
import { translationFor } from "../shared/i18n/translations.js";
import { metadataForRoute } from "../shared/routing/routeRegistry.js";

export function RouteRuntime({ PageComponent, routeId }) {
  const [language, setLanguage] = useState(getInitialLanguage);
  const t = translationFor(language);

  useEffect(() => {
    document.documentElement.lang = t.htmlLang;
    const pageMetadata = metadataForRoute(routeId, t.htmlLang);
    document.title = productPageTitle(pageMetadata.title);
    document.querySelector('meta[name="description"]')?.setAttribute("content", pageMetadata.description);
    writeLanguagePreference(language);
  }, [language, routeId, t]);

  return <PageComponent language={language} setLanguage={setLanguage} t={t} />;
}
