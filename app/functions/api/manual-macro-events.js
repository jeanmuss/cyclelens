import {
  MANUAL_MACRO_EVENTS_MAX_BODY_BYTES,
  normalizeManualMacroEventsPayload,
} from "../../scripts/manual-macro-events-contract.mjs";
import {
  readRemoteManualEvents,
  replaceRemoteManualEvents,
} from "../lib/manual-events-supabase.js";
import {
  jsonResponse,
  readBoundedJson,
  validateAdminOrigin,
} from "../lib/request-policy.js";

function responsePayload(payload, extra = {}) {
  return {
    ...payload,
    canonicalWriteAvailable: true,
    publication: { state: "queued_for_next_projection" },
    ...extra,
  };
}

function clientError(error) {
  const code = String(error?.message || "request_invalid");
  const bodyErrors = new Set([
    "content_type_must_be_json",
    "request_body_invalid_json",
    "request_body_required",
    "request_body_too_large",
  ]);
  if (bodyErrors.has(code) || code.startsWith("events[") || code.startsWith("duplicate ") || [
    "manual macro events JSON must contain an events array",
    "numeric field must be finite",
    "request body must be an object",
    "source URL must be an absolute HTTP(S) URL",
    "source URL must use HTTP(S)",
    "too many manual events",
  ].includes(code) || code.startsWith("text exceeds ") || code === "release time must be a valid timestamp") {
    return jsonResponse(code === "request_body_too_large" ? 413 : 400, { error: code });
  }
  return null;
}

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method.toUpperCase();
  if (!context.data?.accessIdentity?.actor) return jsonResponse(401, { error: "access_identity_required" });
  if (!validateAdminOrigin(request, env, { requireHeader: method !== "GET" })) {
    return jsonResponse(403, { error: "request_origin_denied" });
  }
  if (!new Set(["GET", "PUT"]).has(method)) {
    return jsonResponse(405, { error: "method_not_allowed" }, { allow: "GET, PUT" });
  }

  try {
    if (method === "GET") {
      return jsonResponse(200, responsePayload(await readRemoteManualEvents(env)));
    }

    const input = await readBoundedJson(request, MANUAL_MACRO_EVENTS_MAX_BODY_BYTES);
    const normalized = normalizeManualMacroEventsPayload(input);
    const result = await replaceRemoteManualEvents(normalized, context.data.accessIdentity.actor, env);
    console.info({
      event: "cyclelens_admin_manual_events_saved",
      actor: context.data.accessIdentity.actor,
      upserted: result.changes.upserted,
      deleted: result.changes.deleted,
    });
    return jsonResponse(200, responsePayload(result.payload, { changes: result.changes }));
  } catch (error) {
    const response = clientError(error);
    if (response) return response;
    console.error({
      event: "cyclelens_admin_manual_events_failed",
      actor: context.data.accessIdentity.actor,
      reason: error?.code || "internal_error",
    });
    return jsonResponse(Number(error?.status) || 500, { error: error?.code || "internal_error" });
  }
}
