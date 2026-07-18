import { ADMIN_DEFAULT_ROUTE, ADMIN_PAGE_ENABLED } from "./buildTarget.js";
import { pageForLocation } from "./routeResolver.js";

export { ADMIN_PAGE_ENABLED };

export function currentPage() {
  if (typeof window === "undefined") return "dashboard";
  return pageForLocation({
    hash: window.location.hash,
    pathname: window.location.pathname,
    adminEnabled: ADMIN_PAGE_ENABLED,
    adminDefault: ADMIN_DEFAULT_ROUTE,
  });
}
