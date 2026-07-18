import { routeIdForPath } from "./shared/routing/routeRegistry.js";
import { routePathname } from "./shared/routing/pathname.js";

export { routePathname };

export function pageForLocation({ hash = "", pathname = "/", baseUrl, adminEnabled = false } = {}) {
  const hashPath = String(hash).replace(/^#/, "");
  if (hashPath.startsWith("/") || hashPath === "") {
    return routeIdForPath(hashPath || "/", { adminEnabled });
  }

  const routedPathname = routePathname(pathname, baseUrl);
  return routeIdForPath(routedPathname, { adminEnabled });
}
