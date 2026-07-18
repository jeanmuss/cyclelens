import { pageForLocation } from "./routeResolver.js";

export const ADMIN_PAGE_ENABLED = import.meta.env.DEV;

export function currentPage() {
  if (typeof window === "undefined") return "crypto";
  return pageForLocation({
    hash: window.location.hash,
    pathname: window.location.pathname,
    adminEnabled: ADMIN_PAGE_ENABLED,
  });
}
