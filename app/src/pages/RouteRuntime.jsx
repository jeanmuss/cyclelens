import { useEffect, useState } from "react";

import { productPageTitle } from "../../product.config.mjs";
import { writeLanguagePreference } from "../localPreferences.js";
import { getInitialLanguage, TRANSLATIONS } from "./AppShared.jsx";

export function RouteRuntime({ PageComponent, metadata }) {
  const [language, setLanguage] = useState(getInitialLanguage);
  const t = TRANSLATIONS[language];

  useEffect(() => {
    document.documentElement.lang = t.htmlLang;
    const pageMetadata = metadata(t);
    document.title = productPageTitle(pageMetadata.title);
    document.querySelector('meta[name="description"]')?.setAttribute("content", pageMetadata.description);
    writeLanguagePreference(language);
  }, [language, metadata, t]);

  return <PageComponent language={language} setLanguage={setLanguage} t={t} />;
}
