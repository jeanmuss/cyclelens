const storageKeys = Object.freeze({
  language: "language",
  marketClockHideCrypto: "market-clock:hide-crypto",
});

const legacyStorageKeys = Object.freeze({
  language: "cycle-map-language",
  marketClockHideCrypto: "cycle-map-hide-crypto",
});

const buildTargets = Object.freeze({
  public: "public",
  development: "development",
  admin: "admin",
});

const localAdmin = Object.freeze({
  requestHeader: "x-cyclelens-admin",
  defaultActor: "cyclelens_local_admin",
});

export const PRODUCT_CONFIG = Object.freeze({
  name: "CycleLens",
  repositoryName: "cyclelens",
  legacyRepositoryName: "cycle-map",
  storageNamespace: "cyclelens",
  storageKeys,
  legacyStorageKeys,
  buildTargets,
  localAdmin,
});

export function productPageTitle(title, productName = PRODUCT_CONFIG.name) {
  const pageTitle = String(title || "").trim();
  return pageTitle && pageTitle !== productName ? `${pageTitle} | ${productName}` : productName;
}

export function productUserAgent(component, version = "1.0") {
  const componentName = String(component || "").trim();
  if (!componentName) throw new Error("A product User-Agent component is required");
  return `${PRODUCT_CONFIG.repositoryName}-${componentName}/${version}`;
}

export function preferredEnvironmentValue(environment, primaryName, legacyName) {
  const primaryValue = environment?.[primaryName];
  return primaryValue == null ? environment?.[legacyName] : primaryValue;
}

export function productStorageKey(key, namespace = PRODUCT_CONFIG.storageNamespace) {
  return `${namespace}:${key}`;
}

export function repositoryNameFromGitHub(value, fallback = PRODUCT_CONFIG.repositoryName) {
  const segments = String(value || "").split("/").filter(Boolean);
  return segments.at(-1) || fallback;
}

export function githubPagesBase({ githubRepository, explicitBase } = {}) {
  if (explicitBase) return explicitBase;
  return `/${repositoryNameFromGitHub(githubRepository)}/`;
}

export function resolveBuildTarget(value, fallback = PRODUCT_CONFIG.buildTargets.public) {
  return Object.values(PRODUCT_CONFIG.buildTargets).includes(value) ? value : fallback;
}

export function isAdminBuildTarget(value) {
  return value === PRODUCT_CONFIG.buildTargets.development || value === PRODUCT_CONFIG.buildTargets.admin;
}
