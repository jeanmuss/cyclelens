import { validateAccessRequest } from "./lib/access-auth.js";

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data:",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
].join("; ");

function securityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set("content-security-policy", CONTENT_SECURITY_POLICY);
  headers.set("permissions-policy", "camera=(), geolocation=(), microphone=(), payment=(), usb=()");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  headers.set("cache-control", "private, no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function onRequest(context) {
  let identity;
  try {
    identity = await validateAccessRequest(context.request, context.env);
  } catch (error) {
    console.warn({
      event: "cyclelens_admin_access_denied",
      reason: error?.code || "access_validation_failed",
      ray: String(context.request.headers.get("cf-ray") || "").split("-")[0] || null,
    });
    return securityHeaders(new Response("Unauthorized", { status: 401 }));
  }
  context.data.accessIdentity = identity;
  return securityHeaders(await context.next());
}
