import { resolve } from "node:path";

export const DATA_USE_SCOPES = Object.freeze({
  PUBLIC: "public",
  OWNER_PRIVATE: "owner_private",
});

export const DATA_USE_SCOPE_VALUES = Object.freeze(Object.values(DATA_USE_SCOPES));

export function normalizeDataUseScope(value, fallback = DATA_USE_SCOPES.PUBLIC) {
  const candidate = String(value || "").trim().toLowerCase();
  if (!candidate) return fallback;
  if (!DATA_USE_SCOPE_VALUES.includes(candidate)) {
    throw new Error(`Unsupported data-use scope: ${candidate}`);
  }
  return candidate;
}

export function dataUseScopeFromEnvironment(environment = process.env, argv = process.argv) {
  const argumentsList = [...(argv || [])].map(String);
  const scopeArgument = argumentsList.find((value) => value.startsWith("--scope="));
  const splitIndex = argumentsList.indexOf("--scope");
  const argumentValue = scopeArgument
    ? scopeArgument.slice("--scope=".length)
    : splitIndex >= 0
      ? argumentsList[splitIndex + 1]
      : null;
  const requestedScope = argumentValue || environment?.CYCLELENS_DATA_USE_SCOPE;
  if (!String(requestedScope || "").trim()) {
    throw new Error("Data-use scope must be explicit via --scope or CYCLELENS_DATA_USE_SCOPE");
  }
  return normalizeDataUseScope(requestedScope);
}

export function ownerPrivateUseApproved(environment = process.env) {
  return environment?.CYCLELENS_OWNER_PRIVATE_USE_APPROVED === "1";
}

export function visibilityForDataUseScope(scope) {
  return normalizeDataUseScope(scope) === DATA_USE_SCOPES.OWNER_PRIVATE ? "private" : "public";
}

export function dataDirectoryForScope(appRoot, scope) {
  const normalizedScope = normalizeDataUseScope(scope);
  return normalizedScope === DATA_USE_SCOPES.OWNER_PRIVATE
    ? resolve(appRoot, "data", "private", "raw")
    : resolve(appRoot, "public", "data");
}

export function manualMacroEventsPathForScope(appRoot, scope) {
  const normalizedScope = normalizeDataUseScope(scope);
  return normalizedScope === DATA_USE_SCOPES.OWNER_PRIVATE
    ? resolve(appRoot, "data", "private", "manual-macro-events.json")
    : resolve(appRoot, "data", "manual-macro-events.json");
}

export function cacheRootForScope(workspaceRoot, scope) {
  const normalizedScope = normalizeDataUseScope(scope);
  return normalizedScope === DATA_USE_SCOPES.OWNER_PRIVATE
    ? resolve(workspaceRoot, "tmp", "owner-private")
    : resolve(workspaceRoot, "tmp");
}
