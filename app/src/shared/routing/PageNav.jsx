import { appHashUrl } from "../../data.js";
import { ADMIN_PAGE_ENABLED } from "../../buildTarget.js";
import { navigationIdentity, navigationRoutes } from "./routeRegistry.js";

export function PageNav({ page, t }) {
  return (
    <nav className="page-nav" aria-label="Page">
      {navigationRoutes({ adminEnabled: ADMIN_PAGE_ENABLED }).map((route) => {
        const active = page === route.id;
        return (
          <a
            key={route.id}
            className={active ? "is-active" : ""}
            aria-current={active ? "page" : undefined}
            href={appHashUrl(route.hashPath)}
          >
            {navigationIdentity(route.id, t.htmlLang).navLabel}
          </a>
        );
      })}
    </nav>
  );
}
