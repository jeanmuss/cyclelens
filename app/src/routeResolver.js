import { routeIdForPath } from "./shared/routing/routeRegistry.js";

export function routePathname(pathname, baseUrl = "/") {
  const path = pathname || "/";
  const basePath = new URL(baseUrl, "https://app.local").pathname.replace(/\/$/, "");
  if (basePath && path === basePath) return "/";
  if (basePath && path.startsWith(`${basePath}/`)) return path.slice(basePath.length) || "/";
  return path;
}

export function pageForLocation({ hash = "", pathname = "/", baseUrl, adminEnabled = false } = {}) {
  const hashPath = String(hash).replace(/^#/, "");
  if (hashPath.startsWith("/") || hashPath === "") {
    return routeIdForPath(hashPath || "/", { adminEnabled });
  }

  const routedPathname = routePathname(pathname, baseUrl);
  return routeIdForPath(routedPathname, { adminEnabled });
}
