import { pageIdentity, pageMetadata } from "../i18n/pageIdentity.js";

export const DEFAULT_ROUTE_ID = "crypto";

function routeDefinition(definition) {
  return Object.freeze({
    admin: false,
    navigation: true,
    dataDependencies: Object.freeze([]),
    ...definition,
  });
}

export const PUBLIC_ROUTE_REGISTRY = Object.freeze([
  routeDefinition({
    id: "crypto",
    hashPath: "",
    matchPath: "/",
    dataDependencies: Object.freeze(["marketMonthly"]),
    loadRoute: () => import("../../routes/CryptoRoute.js"),
  }),
  routeDefinition({
    id: "cryptoLiquidity",
    hashPath: "crypto-liquidity",
    matchPath: "/crypto-liquidity",
    dataDependencies: Object.freeze(["cryptoLiquidity"]),
    loadRoute: () => import("../../routes/CryptoLiquidityRoute.js"),
  }),
  routeDefinition({
    id: "macro",
    hashPath: "macro-calendar",
    matchPath: "/macro-calendar",
    dataDependencies: Object.freeze(["macroCalendar"]),
    loadRoute: () => import("../../routes/MacroRoute.js"),
  }),
  routeDefinition({
    id: "equity",
    hashPath: "equity-macro",
    matchPath: "/equity-macro",
    dataDependencies: Object.freeze(["equityWeekly", "equityFast", "chartSeries"]),
    loadRoute: () => import("../../routes/EquityRoute.js"),
  }),
  routeDefinition({
    id: "marketClock",
    hashPath: "market-clock",
    matchPath: "/market-clock",
    dataDependencies: Object.freeze(["marketSession"]),
    loadRoute: () => import("../../routes/MarketClockRoute.js"),
  }),
  routeDefinition({
    id: "chipChain",
    hashPath: "chip-chain",
    matchPath: "/chip-chain",
    dataDependencies: Object.freeze(["chipChain"]),
    loadRoute: () => import("../../routes/ChipChainRoute.js"),
  }),
  routeDefinition({
    id: "robotChain",
    hashPath: "robot-chain",
    matchPath: "/robot-chain",
    dataDependencies: Object.freeze(["robotChain"]),
    loadRoute: () => import("../../routes/RobotChainRoute.js"),
  }),
]);

export const ADMIN_ROUTE_DEFINITION = routeDefinition({
  id: "macroAdmin",
  hashPath: "admin/macro-events",
  matchPath: "/admin/macro-events",
  admin: true,
  dataDependencies: Object.freeze(["macroCalendar", "manualMacroEvents"]),
});

const ALL_ROUTE_REGISTRY = Object.freeze([...PUBLIC_ROUTE_REGISTRY, ADMIN_ROUTE_DEFINITION]);
const ROUTES_BY_ID = new Map(ALL_ROUTE_REGISTRY.map((route) => [route.id, route]));

export function registeredRoutes({ adminEnabled = false } = {}) {
  return adminEnabled ? ALL_ROUTE_REGISTRY : PUBLIC_ROUTE_REGISTRY;
}

export function registeredRoute(pageId, { adminEnabled = false } = {}) {
  const route = ROUTES_BY_ID.get(pageId);
  if (!route || (route.admin && !adminEnabled)) return ROUTES_BY_ID.get(DEFAULT_ROUTE_ID);
  return route;
}

export function routeIdForPath(path, { adminEnabled = false } = {}) {
  const normalizedPath = String(path || "/");
  for (const route of registeredRoutes({ adminEnabled })) {
    if (route.id !== DEFAULT_ROUTE_ID && normalizedPath.startsWith(route.matchPath)) return route.id;
  }
  return DEFAULT_ROUTE_ID;
}

export function navigationRoutes({ adminEnabled = false } = {}) {
  return registeredRoutes({ adminEnabled }).filter((route) => route.navigation);
}

export function navigationIdentity(pageId, language) {
  return pageIdentity(pageId, language);
}

export function metadataForRoute(pageId, language) {
  return pageMetadata(pageId, language);
}
