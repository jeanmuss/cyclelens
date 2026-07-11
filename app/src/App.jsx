import { lazy, Suspense, useEffect, useState } from "react";
import { routePathname } from "./data.js";

const ADMIN_PAGE_ENABLED = import.meta.env.DEV;

// Route wrappers use distinct module queries so Vite can tree-shake each page into
// its own lazy chunk instead of rebuilding the former all-pages entry bundle.
const CryptoRoute = lazy(() => import("./routes/CryptoRoute.js"));
const MacroRoute = lazy(() => import("./routes/MacroRoute.js"));
const EquityRoute = lazy(() => import("./routes/EquityRoute.js"));
const MarketClockRoute = lazy(() => import("./routes/MarketClockRoute.js"));
const ChipChainRoute = lazy(() => import("./routes/ChipChainRoute.js"));
const RobotChainRoute = lazy(() => import("./routes/RobotChainRoute.js"));
const MacroAdminRoute = ADMIN_PAGE_ENABLED
  ? lazy(() => import("./routes/MacroAdminRoute.js"))
  : null;

function currentPage() {
  if (typeof window === "undefined") return "crypto";
  const hashPath = window.location.hash.replace(/^#/, "");
  if (ADMIN_PAGE_ENABLED && hashPath.startsWith("/admin/macro-events")) return "macroAdmin";
  if (hashPath.startsWith("/robot-chain")) return "robotChain";
  if (hashPath.startsWith("/chip-chain")) return "chipChain";
  if (hashPath.startsWith("/market-clock")) return "marketClock";
  if (hashPath.startsWith("/macro-calendar")) return "macro";
  if (hashPath.startsWith("/equity-macro")) return "equity";
  if (hashPath.startsWith("/") || hashPath === "") return "crypto";
  const pathname = routePathname(window.location.pathname);
  if (ADMIN_PAGE_ENABLED && pathname.startsWith("/admin/macro-events")) return "macroAdmin";
  if (pathname.startsWith("/robot-chain")) return "robotChain";
  if (pathname.startsWith("/chip-chain")) return "chipChain";
  if (pathname.startsWith("/market-clock")) return "marketClock";
  if (pathname.startsWith("/macro-calendar")) return "macro";
  return pathname.startsWith("/equity-macro") ? "equity" : "crypto";
}

function routeComponent(page) {
  if (page === "macroAdmin" && MacroAdminRoute) return MacroAdminRoute;
  if (page === "robotChain") return RobotChainRoute;
  if (page === "chipChain") return ChipChainRoute;
  if (page === "marketClock") return MarketClockRoute;
  if (page === "macro") return MacroRoute;
  if (page === "equity") return EquityRoute;
  return CryptoRoute;
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
    <Suspense fallback={<main className="status-page" data-testid="route-loading"><p>\u6b63\u5728\u52a0\u8f7d\u9875\u9762\u2026 / Loading page\u2026</p></main>}>
      <Page />
    </Suspense>
  );
}
