import { lazy, Suspense, useEffect, useState } from "react";
import { ADMIN_PAGE_ENABLED, currentPage } from "./routeState.js";
import { DataState } from "./shared/components/DataState.jsx";
import { PUBLIC_ROUTE_LOADERS } from "./shared/routing/routeLoaders.js";
import { DEFAULT_ROUTE_ID, PUBLIC_ROUTE_REGISTRY } from "./shared/routing/routeRegistry.js";

// Each route owns a physical page module and a separate lazy chunk.
const publicRouteComponents = Object.freeze(Object.fromEntries(
  PUBLIC_ROUTE_REGISTRY.map((route) => [route.id, lazy(PUBLIC_ROUTE_LOADERS[route.id])]),
));
const MacroAdminRoute = ADMIN_PAGE_ENABLED
  ? lazy(() => import("./routes/MacroAdminRoute.js"))
  : null;

function routeComponent(page) {
  if (page === "macroAdmin" && MacroAdminRoute) return MacroAdminRoute;
  return publicRouteComponents[page] || publicRouteComponents[DEFAULT_ROUTE_ID];
}

export function App() {
  const [page, setPage] = useState(currentPage);

  useEffect(() => {
    const syncPage = () => setPage(currentPage());
    window.addEventListener("hashchange", syncPage);
    window.addEventListener("popstate", syncPage);
    return () => {
      window.removeEventListener("hashchange", syncPage);
      window.removeEventListener("popstate", syncPage);
    };
  }, []);

  const Page = routeComponent(page);
  return (
    <Suspense fallback={<DataState as="main" variant="loading" className="status-page" data-testid="route-loading"><p>\u6b63\u5728\u52a0\u8f7d\u9875\u9762\u2026 / Loading page\u2026</p></DataState>}>
      <Page />
    </Suspense>
  );
}
