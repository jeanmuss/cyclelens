export function routePathname(pathname, baseUrl = "/") {
  const path = pathname || "/";
  const basePath = new URL(baseUrl, "https://app.local").pathname.replace(/\/$/, "");
  if (basePath && path === basePath) return "/";
  if (basePath && path.startsWith(`${basePath}/`)) return path.slice(basePath.length) || "/";
  return path;
}

export function pageForLocation({ hash = "", pathname = "/", baseUrl, adminEnabled = false } = {}) {
  const hashPath = String(hash).replace(/^#/, "");
  if (adminEnabled && hashPath.startsWith("/admin/macro-events")) return "macroAdmin";
  if (hashPath.startsWith("/crypto-liquidity")) return "cryptoLiquidity";
  if (hashPath.startsWith("/robot-chain")) return "robotChain";
  if (hashPath.startsWith("/chip-chain")) return "chipChain";
  if (hashPath.startsWith("/market-clock")) return "marketClock";
  if (hashPath.startsWith("/macro-calendar")) return "macro";
  if (hashPath.startsWith("/equity-macro")) return "equity";
  if (hashPath.startsWith("/") || hashPath === "") return "crypto";

  const routedPathname = routePathname(pathname, baseUrl);
  if (adminEnabled && routedPathname.startsWith("/admin/macro-events")) return "macroAdmin";
  if (routedPathname.startsWith("/crypto-liquidity")) return "cryptoLiquidity";
  if (routedPathname.startsWith("/robot-chain")) return "robotChain";
  if (routedPathname.startsWith("/chip-chain")) return "chipChain";
  if (routedPathname.startsWith("/market-clock")) return "marketClock";
  if (routedPathname.startsWith("/macro-calendar")) return "macro";
  return routedPathname.startsWith("/equity-macro") ? "equity" : "crypto";
}
