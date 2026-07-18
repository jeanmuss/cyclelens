export function routePathname(pathname, baseUrl = "/") {
  const path = pathname || "/";
  const basePath = new URL(baseUrl, "https://app.local").pathname.replace(/\/$/, "");
  if (basePath && path === basePath) return "/";
  if (basePath && path.startsWith(`${basePath}/`)) return path.slice(basePath.length) || "/";
  return path;
}
