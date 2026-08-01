import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { preferredEnvironmentValue } from "../product.config.mjs";
import { sourcePolicyIdIsEligibleForDataUse } from "../src/domain/metrics/sourcePolicy.js";
import { dataUseScopeFromEnvironment } from "./data-use-scope.mjs";
import {
  CmcProviderStateError,
  budgetForNow,
  creditCountFromCmcPayload,
  makeCmcProviderState,
  mergeCmcHistory,
  normalizeCmcCurrentPayloads,
  normalizeCmcHistoryPayloads,
  parseCurrentIntervalMs,
  parseRequiredCmcBudgets,
  planCmcProviderRefresh,
} from "./cmc-provider-state-contract.mjs";
import {
  createCmcProviderStateStore,
} from "./cmc-provider-state-store.mjs";
import { fetchJsonBounded } from "./secure-fetch.mjs";

const CMC_ORIGIN = "https://pro-api.coinmarketcap.com";
const MAX_CMC_RESPONSE_BYTES = 12 * 1024 * 1024;
const CMC_REQUEST_TIMEOUT_MS = 30_000;

async function loadEnvFile(path, environment) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (cause) {
    if (cause?.code === "ENOENT") return;
    throw error("cmc_local_environment_read_failed");
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || environment[match[1]]) continue;
    let value = match[2].trim();
    if ((value.startsWith("\"") && value.endsWith("\""))
      || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    environment[match[1]] = value;
  }
}

function error(code) {
  const failure = new Error(code);
  failure.code = code;
  return failure;
}

function enabled(environment) {
  const value = String(environment?.CYCLELENS_COLLECT_CMC || "").trim();
  if (!new Set(["true", "false"]).has(value)) throw error("cmc_collection_opt_in_invalid");
  return value === "true";
}

function runId(environment) {
  const githubRun = String(environment?.GITHUB_RUN_ID || "").trim();
  const githubAttempt = String(environment?.GITHUB_RUN_ATTEMPT || "").trim();
  if (githubRun) return `github-${githubRun}-${githubAttempt || "1"}`;
  return `local-${randomUUID()}`;
}

function keyFrom(environment) {
  const key = String(environment?.CMC_PRO_API_KEY || "").trim();
  if (!key) throw error("cmc_api_key_required");
  return key;
}

function genericFailure(errorValue) {
  if (errorValue instanceof CmcProviderStateError) return errorValue;
  const code = String(errorValue?.code || errorValue?.message || "");
  if (/^(?:cmc|provider)_[a-z0-9_]+$/.test(code)) return error(code);
  return error("cmc_provider_request_failed");
}

function requestGroups(plan) {
  return {
    current: plan.requests.filter((request) => request.kind.startsWith("current_")),
    history: plan.requests.filter((request) => request.kind.startsWith("history_")),
  };
}

function nextBudget(base, chargedCredits) {
  return {
    ...base,
    dailyCreditsReserved: base.dailyCreditsReserved + chargedCredits,
    monthlyCreditsReserved: base.monthlyCreditsReserved + chargedCredits,
  };
}

function nextWatermarks(previous, {
  attemptedAt,
  currentAttempted,
  currentSuccessful,
  historyAttempted,
  historySuccessful,
}) {
  return {
    lastAttemptedAt: currentAttempted ? attemptedAt : previous?.lastAttemptedAt || null,
    lastSuccessfulAt: currentSuccessful ? attemptedAt : previous?.lastSuccessfulAt || null,
    lastHistoryAttemptedAt: historyAttempted ? attemptedAt : previous?.lastHistoryAttemptedAt || null,
    lastHistorySuccessfulAt: historySuccessful ? attemptedAt : previous?.lastHistorySuccessfulAt || null,
  };
}

async function defaultCmcRequest(url, { key, fetchImpl = fetch } = {}) {
  return fetchJsonBounded(url, {
    allowedOrigins: [CMC_ORIGIN],
    fetchImpl,
    headers: { "X-CMC_PRO_API_KEY": key },
    timeoutMs: CMC_REQUEST_TIMEOUT_MS,
    maxResponseBytes: MAX_CMC_RESPONSE_BYTES,
  });
}

function validatePrivateCollectionBoundary(environment) {
  if (environment?.CYCLELENS_DATA_USE_SCOPE !== "owner_private"
    || environment?.CYCLELENS_OWNER_PRIVATE_USE_APPROVED !== "1") {
    throw error("cmc_owner_private_boundary_required");
  }
  if (!sourcePolicyIdIsEligibleForDataUse("coinmarketcap", {
    scope: "owner_private",
    environment,
  })) {
    throw error("cmc_source_policy_denied");
  }
}

export async function refreshCmcProviderState({
  environment = process.env,
  workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."),
  now = () => new Date(),
  fetchImpl = fetch,
  requestCmc = defaultCmcRequest,
  store: providedStore = null,
} = {}) {
  const collectionEnabled = enabled(environment);
  validatePrivateCollectionBoundary(environment);
  const store = providedStore || createCmcProviderStateStore({
    workspaceRoot,
    environment,
    fetchImpl,
    now,
  });
  const loaded = await store.load();
  const previous = loaded.state;
  if (!collectionEnabled) {
    if (!previous) {
      return { status: "disabled", state: null, networkRequests: 0, creditCount: 0 };
    }
    const current = new Date(now());
    const budget = budgetForNow({
      budgets: {
        dailyCreditBudget: previous.budget.dailyCreditBudget,
        monthlyCreditBudget: previous.budget.monthlyCreditBudget,
      },
      ledger: loaded.ledger,
      now: current,
    });
    const state = makeCmcProviderState({
      previous,
      history: loaded.history,
      watermarks: loaded.watermarks || previous.watermarks,
      budget,
      refresh: {
        mode: "disabled",
        networkRequests: 0,
        creditCount: 0,
        currentRefreshed: false,
        historyRefreshed: false,
      },
      now: current,
    });
    await store.saveLocal(state);
    return { status: "disabled", state, networkRequests: 0, creditCount: 0 };
  }
  const budgets = parseRequiredCmcBudgets(environment);
  const currentIntervalMs = parseCurrentIntervalMs(environment);
  const key = keyFrom(environment);
  if (!loaded.remoteAvailable) {
    if (!previous) throw error("cmc_local_lkg_required");
    return {
      status: "local_lkg_only",
      state: previous,
      networkRequests: 0,
      creditCount: 0,
    };
  }

  const startedAt = new Date(now());
  const budget = budgetForNow({ budgets, ledger: loaded.ledger, now: startedAt });
  const plan = planCmcProviderRefresh({
    state: previous,
    hydratedHistory: loaded.history,
    restoredWatermarks: loaded.watermarks,
    budget,
    now: startedAt,
    currentIntervalMs,
  });
  const groups = requestGroups(plan);
  if (!plan.requests.length) {
    if (!previous) {
      throw error(plan.currentGuarded || plan.historyGuarded ? "cmc_budget_guard_no_lkg" : "cmc_lkg_required");
    }
    const mode = plan.currentGuarded || plan.historyGuarded ? "budget_guard" : "cadence_guard";
    const state = makeCmcProviderState({
      previous,
      history: loaded.history,
      watermarks: previous.watermarks,
      budget,
      refresh: {
        mode,
        networkRequests: 0,
        creditCount: 0,
        currentRefreshed: false,
        historyRefreshed: false,
      },
      now: startedAt,
    });
    await store.saveLocal(state);
    return { status: mode, state, networkRequests: 0, creditCount: 0 };
  }

  const reservation = await store.reserve({
    runId: runId(environment),
    plan,
    budget,
  });
  let networkRequests = 0;
  let creditCount = 0;
  let current = previous?.current || null;
  let history = loaded.history || previous?.history || {};
  let historyDelta = {};
  let currentRefreshed = false;
  let historyRefreshed = false;
  let currentAttempted = false;
  let historyAttempted = false;
  let completedPersisted = false;
  const attemptedAt = new Date(startedAt).toISOString();

  const execute = async (request) => {
    networkRequests += 1;
    const payload = await requestCmc(request.url, { key, fetchImpl, request });
    creditCount += creditCountFromCmcPayload(payload);
    const dailyTotal = budget.dailyCreditsReserved + creditCount;
    const monthlyTotal = budget.monthlyCreditsReserved + creditCount;
    if (creditCount > plan.reservedCredits
      || dailyTotal > budget.dailyCreditBudget
      || monthlyTotal > budget.monthlyCreditBudget) {
      throw error("cmc_budget_exceeded_by_provider");
    }
    return payload;
  };

  try {
    if (groups.current.length) {
      if (groups.current.length !== 2) throw error("cmc_current_plan_invalid");
      currentAttempted = true;
      const globalPayload = await execute(groups.current[0]);
      const assetsPayload = await execute(groups.current[1]);
      current = normalizeCmcCurrentPayloads(globalPayload, assetsPayload, startedAt);
      currentRefreshed = true;
    }
    if (groups.history.length) {
      if (groups.history.length !== 2) throw error("cmc_history_plan_invalid");
      historyAttempted = true;
      const globalPayload = await execute(groups.history[0]);
      const assetsPayload = await execute(groups.history[1]);
      historyDelta = normalizeCmcHistoryPayloads(globalPayload, assetsPayload, startedAt);
      history = mergeCmcHistory(
        loaded.history,
        historyDelta,
      );
      historyRefreshed = true;
    }
    if (!current) throw error("cmc_current_lkg_required");
    const watermarks = nextWatermarks(previous?.watermarks || loaded.watermarks, {
      attemptedAt,
      currentAttempted,
      currentSuccessful: currentRefreshed,
      historyAttempted,
      historySuccessful: historyRefreshed,
    });
    const mode = plan.currentGuarded || plan.historyGuarded ? "budget_guard" : "refreshed";
    const state = makeCmcProviderState({
      previous,
      current,
      history,
      watermarks,
      budget: nextBudget(budget, creditCount),
      refresh: {
        mode,
        networkRequests,
        creditCount,
        currentRefreshed,
        historyRefreshed,
      },
      now: startedAt,
    });
    await store.finish(reservation, {
      status: "completed",
      state,
      creditCount,
      currentAttempted,
      historyAttempted,
      ...(historyRefreshed ? { historyDelta } : {}),
    });
    completedPersisted = true;
    await store.saveLocal(state);
    return { status: mode, state, networkRequests, creditCount };
  } catch (cause) {
    const failure = genericFailure(cause);
    if (completedPersisted) throw failure;
    const watermarks = nextWatermarks(previous?.watermarks || loaded.watermarks, {
      attemptedAt,
      currentAttempted,
      currentSuccessful: currentRefreshed,
      historyAttempted,
      historySuccessful: false,
    });
    let fallback = null;
    if (current) {
      fallback = makeCmcProviderState({
        previous,
        current,
        history: loaded.history,
        watermarks,
        budget: nextBudget(budget, Math.max(plan.reservedCredits, creditCount)),
        refresh: {
          mode: "provider_failed_lkg",
          networkRequests,
          creditCount,
          currentRefreshed,
          historyRefreshed: false,
        },
        now: startedAt,
      });
    }
    await store.finish(reservation, {
      status: "failed",
      state: fallback,
      creditCount,
      error: failure,
      currentAttempted,
      historyAttempted,
    });
    if (!fallback) throw failure;
    await store.saveLocal(fallback);
    return {
      status: "provider_failed_lkg",
      state: fallback,
      networkRequests,
      creditCount,
      errorCode: failure.code || failure.message,
    };
  }
}

export async function main(options = {}) {
  const environment = options.environment || process.env;
  const workspaceRoot = options.workspaceRoot || resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const appRoot = resolve(workspaceRoot, "app");
  if (preferredEnvironmentValue(environment, "CYCLELENS_SKIP_LOCAL_ENV", "CYCLE_MAP_SKIP_LOCAL_ENV") !== "1") {
    await loadEnvFile(resolve(appRoot, ".env.local"), environment);
    await loadEnvFile(resolve(workspaceRoot, ".env.local"), environment);
  }
  const dataUseScope = dataUseScopeFromEnvironment(environment, options.argv || process.argv);
  const result = await refreshCmcProviderState({
    ...options,
    workspaceRoot,
    environment: { ...environment, CYCLELENS_DATA_USE_SCOPE: dataUseScope },
  });
  console.log(JSON.stringify({
    status: result.status,
    networkRequests: result.networkRequests,
    creditCount: result.creditCount,
    hasState: Boolean(result.state),
  }));
  return result;
}

const directRun = process.argv[1]
  && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (directRun) {
  main().catch((cause) => {
    const failure = genericFailure(cause);
    console.error(JSON.stringify({ status: "failed", errorCode: failure.code || failure.message }));
    process.exitCode = 1;
  });
}
