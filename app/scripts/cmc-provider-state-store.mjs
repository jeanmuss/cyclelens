import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { fetchJsonBounded } from "./secure-fetch.mjs";
import {
  CMC_HISTORY_METRIC_IDS,
  CMC_PROVIDER_STATE_MAX_BYTES,
  budgetForNow,
  cmcProviderStatePath,
  hasMinimumCmcHistoryCoverage,
  historyFromMarketMetricRows,
  mergeCmcHistory,
  mergeCmcProviderStates,
  validateCmcProviderState,
} from "./cmc-provider-state-contract.mjs";

const DASHBOARD_RUNS_TABLE = "dashboard_snapshot_runs";
const OBSERVATIONS_TABLE = "market_metric_observations";
const PROJECTION_ID = "cmc-provider-state";
const CMC_RESERVATION_RPC = "rpc/reserve_cmc_provider_credits";
const SUPABASE_ALLOWED_RESPONSE_BYTES = 8 * 1024 * 1024;
const SUPABASE_TIMEOUT_MS = 20_000;
const OBSERVATION_PAGE_SIZE = 1000;
const OBSERVATION_MAX_PAGES = 5;
const LEDGER_MAX_ROWS = 1000;
const LATEST_STATE_MAX_ROWS = 200;
const HISTORY_DELTA_LOOKBACK_DAYS = 405;
const HISTORY_DELTA_PAGE_SIZE = 200;
const HISTORY_DELTA_MAX_PAGES = 3;

function clean(value) {
  return String(value ?? "").trim();
}

function serviceKey(environment) {
  return clean(environment?.SUPABASE_SECRET_KEY);
}

function supabaseOrigin(value) {
  let parsed;
  try {
    parsed = new URL(clean(value));
  } catch {
    throw new Error("cmc_supabase_origin_invalid");
  }
  const hosted = parsed.hostname.endsWith(".supabase.co");
  if (parsed.protocol !== "https:"
    || !hosted
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || !["", "/"].includes(parsed.pathname)) {
    throw new Error("cmc_supabase_origin_invalid");
  }
  return parsed.origin;
}

function supabaseConfig(environment) {
  const url = clean(environment?.SUPABASE_URL);
  const key = serviceKey(environment);
  if (!url && !key) return null;
  if (!url || !key) throw new Error("cmc_supabase_config_incomplete");
  return { origin: supabaseOrigin(url), key };
}

function authHeaders(key) {
  const opaque = key.startsWith("sb_");
  return {
    apikey: key,
    ...(!opaque ? { Authorization: `Bearer ${key}` } : {}),
    "Content-Type": "application/json",
  };
}

function safeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

function utcDay(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function utcMonth(value) {
  return utcDay(value).slice(0, 7);
}

function genericErrorCode(error) {
  const code = clean(error?.code || error?.message);
  return /^cmc_[a-z0-9_]+$/.test(code) || /^provider_[a-z0-9_]+$/.test(code)
    ? code.slice(0, 100)
    : "cmc_provider_state_failed";
}

function assertRunPatchSize(value) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error("cmc_supabase_run_payload_invalid");
  }
  if (new TextEncoder().encode(serialized).byteLength > CMC_PROVIDER_STATE_MAX_BYTES) {
    throw new Error("cmc_supabase_run_payload_too_large");
  }
}

function runDetails(row) {
  const nested = row?.details && typeof row.details === "object" && !Array.isArray(row.details)
    ? row.details
    : {};
  return {
    ...nested,
    ...(row?.reservation && typeof row.reservation === "object" ? { reservation: row.reservation } : {}),
    ...(row?.result && typeof row.result === "object" ? { result: row.result } : {}),
    ...(row?.plan && typeof row.plan === "object" ? { plan: row.plan } : {}),
    ...(row?.run_started_at ? { startedAt: row.run_started_at } : {}),
  };
}

export function hasSupabaseCmcProviderStateConfig(environment = process.env) {
  return Boolean(clean(environment?.SUPABASE_URL) && serviceKey(environment));
}

export async function readLocalCmcProviderState(workspaceRoot, { now = new Date() } = {}) {
  const path = cmcProviderStatePath(workspaceRoot);
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error("cmc_local_state_read_failed");
  }
  if (new TextEncoder().encode(raw).byteLength > CMC_PROVIDER_STATE_MAX_BYTES) {
    throw new Error("cmc_state_too_large");
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("cmc_local_state_invalid");
  }
  return validateCmcProviderState(value, { now });
}

export async function writeLocalCmcProviderState(workspaceRoot, state, { now = new Date() } = {}) {
  const normalized = validateCmcProviderState(state, { now });
  const path = cmcProviderStatePath(workspaceRoot);
  const tempPath = `${path}.${process.pid}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(tempPath, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(tempPath, path);
  } catch {
    throw new Error("cmc_local_state_write_failed");
  }
  return normalized;
}

function ledgerFromRows(rows, now) {
  const day = utcDay(now);
  const month = utcMonth(now);
  let dailyCreditsReserved = 0;
  let monthlyCreditsReserved = 0;
  for (const row of rows || []) {
    const details = runDetails(row);
    const reservation = details?.reservation;
    if (!reservation || reservation.utcMonth !== month) continue;
    const reserved = safeInteger(reservation.creditsReserved);
    const actual = Number.isSafeInteger(details?.result?.creditCount)
      && details.result.creditCount >= 0
      ? safeInteger(details.result.creditCount)
      : null;
    const charged = row.status === "completed"
      ? actual ?? reserved
      : Math.max(reserved, actual ?? 0);
    monthlyCreditsReserved += charged;
    if (reservation.utcDay === day) dailyCreditsReserved += charged;
  }
  return { dailyCreditsReserved, monthlyCreditsReserved };
}

function stateAndHistoryFromRunRows(rows, now) {
  let state = null;
  let history = {};
  for (const row of rows || []) {
    const candidate = row?.details?.cmcProviderState;
    if (!candidate) continue;
    let normalized;
    try {
      normalized = validateCmcProviderState(candidate, { now });
    } catch {
      // A malformed historical run is untrusted input; continue to an older valid LKG.
      continue;
    }
    state = mergeCmcProviderStates(state, normalized, { now });
    history = mergeCmcHistory(history, normalized.history);

    const details = row?.details || {};
    const mayContainSuccessfulHistoryDelta = row?.status === "completed"
      && normalized.refresh.historyRefreshed
      && details?.result?.historyAttempted === true;
    if (!mayContainSuccessfulHistoryDelta || !details.cmcHistoryDelta) continue;
    try {
      const stateWithDelta = validateCmcProviderState({
        ...normalized,
        history: details.cmcHistoryDelta,
      }, { now });
      history = mergeCmcHistory(history, stateWithDelta.history);
    } catch {
      // Ignore an invalid delta without discarding the compact state from the same run.
    }
  }
  return { state, history };
}

function latestIso(values) {
  const times = values
    .map((value) => Date.parse(String(value || "")))
    .filter(Number.isFinite);
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

function watermarksFromRunRows(rows) {
  const output = {
    lastAttemptedAt: null,
    lastSuccessfulAt: null,
    lastHistoryAttemptedAt: null,
    lastHistorySuccessfulAt: null,
  };
  for (const row of rows || []) {
    const details = runDetails(row);
    const stateWatermarks = details?.cmcProviderState?.watermarks || {};
    for (const key of Object.keys(output)) {
      output[key] = latestIso([output[key], stateWatermarks[key]]);
    }
    const result = details.result;
    const requestIds = Array.isArray(details?.plan?.requestIds) ? details.plan.requestIds : [];
    const currentAttempted = result
      ? result.currentAttempted === true
      : row.status === "started" && requestIds.some((id) => String(id).startsWith("current_"));
    const historyAttempted = result
      ? result.historyAttempted === true
      : row.status === "started" && requestIds.some((id) => String(id).startsWith("history_"));
    const attemptedAt = details.startedAt || row.created_at;
    if (currentAttempted) output.lastAttemptedAt = latestIso([output.lastAttemptedAt, attemptedAt]);
    if (historyAttempted) output.lastHistoryAttemptedAt = latestIso([output.lastHistoryAttemptedAt, attemptedAt]);
  }
  return output;
}

export function createCmcProviderStateStore({
  workspaceRoot,
  environment = process.env,
  fetchImpl = fetch,
  now = () => new Date(),
} = {}) {
  const config = supabaseConfig(environment);

  async function request(tablePath, options = {}) {
    if (!config) throw new Error("cmc_supabase_required");
    return fetchJsonBounded(`${config.origin}/rest/v1/${tablePath}`, {
      allowedOrigins: [config.origin],
      fetchImpl,
      method: options.method || "GET",
      headers: {
        ...authHeaders(config.key),
        ...(options.prefer ? { Prefer: options.prefer } : {}),
      },
      body: options.body == null ? undefined : JSON.stringify(options.body),
      timeoutMs: SUPABASE_TIMEOUT_MS,
      maxResponseBytes: SUPABASE_ALLOWED_RESPONSE_BYTES,
    });
  }

  async function readLedgerRows() {
    const current = now();
    const monthStart = `${utcMonth(current)}-01T00:00:00.000Z`;
    const query = new URLSearchParams({
      select: "id,status,created_at,reservation:details->reservation,result:details->result,plan:details->plan,run_started_at:details->>startedAt",
      projection_id: `eq.${PROJECTION_ID}`,
      created_at: `gte.${monthStart}`,
      order: "created_at.desc",
      limit: String(LEDGER_MAX_ROWS),
    });
    const rows = await request(`${DASHBOARD_RUNS_TABLE}?${query}`);
    if (!Array.isArray(rows)) throw new Error("cmc_supabase_runs_invalid");
    if (rows.length >= LEDGER_MAX_ROWS) throw new Error("cmc_supabase_runs_limit");
    return rows;
  }

  async function readLatestStateRows() {
    const query = new URLSearchParams({
      select: "id,status,created_at,details",
      projection_id: `eq.${PROJECTION_ID}`,
      status: "in.(completed,failed)",
      order: "created_at.desc",
      limit: String(LATEST_STATE_MAX_ROWS),
    });
    const rows = await request(`${DASHBOARD_RUNS_TABLE}?${query}`);
    if (!Array.isArray(rows)) throw new Error("cmc_supabase_runs_invalid");
    return rows;
  }

  async function readObservationRows() {
    const start = new Date(new Date(now()).getTime() - 405 * 86_400_000).toISOString();
    const rows = [];
    for (let page = 0; page < OBSERVATION_MAX_PAGES; page += 1) {
      const query = new URLSearchParams({
        select: "metric_id,observed_at,value,source,source_url,source_key,quality_status,fetched_at,last_checked_at,metadata",
        metric_id: `in.(${CMC_HISTORY_METRIC_IDS.join(",")})`,
        source_key: "eq.cmc",
        observed_at: `gte.${start}`,
        order: "metric_id.asc,observed_at.asc,source_key.asc",
        limit: String(OBSERVATION_PAGE_SIZE),
        offset: String(page * OBSERVATION_PAGE_SIZE),
      });
      const batch = await request(`${OBSERVATIONS_TABLE}?${query}`);
      if (!Array.isArray(batch)) throw new Error("cmc_supabase_observations_invalid");
      rows.push(...batch);
      if (batch.length < OBSERVATION_PAGE_SIZE) return rows;
    }
    throw new Error("cmc_supabase_observations_limit");
  }

  async function readHistoryDeltaRows(current) {
    const start = new Date(
      new Date(current).getTime() - HISTORY_DELTA_LOOKBACK_DAYS * 86_400_000,
    ).toISOString();
    const rows = [];
    for (let page = 0; page < HISTORY_DELTA_MAX_PAGES; page += 1) {
      const query = new URLSearchParams({
        select: "id,status,created_at,cmc_provider_state:details->cmcProviderState,cmc_history_delta:details->cmcHistoryDelta,history_attempted:details->result->>historyAttempted",
        projection_id: `eq.${PROJECTION_ID}`,
        status: "eq.completed",
        created_at: `gte.${start}`,
        "details->result->>historyAttempted": "eq.true",
        "details->cmcProviderState->refresh->>historyRefreshed": "eq.true",
        "details->cmcHistoryDelta": "not.is.null",
        order: "created_at.asc,id.asc",
        limit: String(HISTORY_DELTA_PAGE_SIZE),
        offset: String(page * HISTORY_DELTA_PAGE_SIZE),
      });
      const batch = await request(`${DASHBOARD_RUNS_TABLE}?${query}`);
      if (!Array.isArray(batch)) throw new Error("cmc_supabase_history_deltas_invalid");
      for (const row of batch) {
        const state = row?.cmc_provider_state;
        const delta = row?.cmc_history_delta;
        if (!row || typeof row !== "object" || Array.isArray(row)
          || row.status !== "completed"
          || !Number.isFinite(Date.parse(String(row.created_at || "")))
          || ![true, "true"].includes(row.history_attempted)
          || !state || typeof state !== "object" || Array.isArray(state)
          || !delta || typeof delta !== "object" || Array.isArray(delta)) {
          throw new Error("cmc_supabase_history_deltas_invalid");
        }
        let normalized;
        try {
          normalized = validateCmcProviderState(state, { now: current });
          const withDelta = validateCmcProviderState({ ...normalized, history: delta }, { now: current });
          if (!normalized.refresh.historyRefreshed
            || !Object.values(withDelta.history).some((points) => points.length > 0)) {
            throw new Error("cmc_supabase_history_deltas_invalid");
          }
          rows.push({
            id: row.id,
            status: "completed",
            created_at: row.created_at,
            details: {
              result: { historyAttempted: true },
              cmcProviderState: normalized,
              cmcHistoryDelta: withDelta.history,
            },
          });
        } catch {
          throw new Error("cmc_supabase_history_deltas_invalid");
        }
      }
      if (batch.length < HISTORY_DELTA_PAGE_SIZE) return rows;
    }
    throw new Error("cmc_supabase_history_deltas_limit");
  }

  async function load() {
    const current = now();
    let local = null;
    try {
      local = await readLocalCmcProviderState(workspaceRoot, { now: current });
    } catch (error) {
      if (!config) throw error;
    }
    if (!config) {
      const ledger = local && local.budget.utcMonth === utcMonth(current)
        ? {
          dailyCreditsReserved: local.budget.utcDay === utcDay(current) ? local.budget.dailyCreditsReserved : 0,
          monthlyCreditsReserved: local.budget.monthlyCreditsReserved,
        }
        : { dailyCreditsReserved: 0, monthlyCreditsReserved: 0 };
      return {
        state: local,
        history: local?.history || {},
        watermarks: local?.watermarks || {},
        ledger,
        remoteAvailable: false,
      };
    }
    const [ledgerRows, latestStateRows, observationRows] = await Promise.all([
      readLedgerRows(),
      readLatestStateRows(),
      readObservationRows(),
    ]);
    const remoteRunData = stateAndHistoryFromRunRows(latestStateRows, current);
    const databaseHistory = historyFromMarketMetricRows(observationRows, current);
    let state = mergeCmcProviderStates(local, remoteRunData.state, { now: current });
    let history = mergeCmcHistory(state?.history, remoteRunData.history, databaseHistory);
    if (!hasMinimumCmcHistoryCoverage(history, current)) {
      const historyDeltaRows = await readHistoryDeltaRows(current);
      history = mergeCmcHistory(
        history,
        stateAndHistoryFromRunRows(historyDeltaRows, current).history,
      );
    }
    const restoredWatermarks = watermarksFromRunRows([...latestStateRows, ...ledgerRows]);
    if (state) {
      state = validateCmcProviderState({
        ...state,
        updatedAt: new Date(current).toISOString(),
        history,
        watermarks: Object.fromEntries(Object.keys(restoredWatermarks).map((key) => [
          key,
          latestIso([state.watermarks[key], restoredWatermarks[key]]),
        ])),
        refresh: {
          mode: "hydrated",
          networkRequests: 0,
          creditCount: 0,
          currentRefreshed: false,
          historyRefreshed: false,
        },
      }, { now: current });
    }
    return {
      state,
      history,
      watermarks: state?.watermarks || restoredWatermarks,
      ledger: ledgerFromRows(ledgerRows, current),
      remoteAvailable: true,
    };
  }

  async function reserve({ runId, plan, budget }) {
    if (!config) throw new Error("cmc_supabase_required");
    const durableRunId = clean(runId);
    const reservedCredits = plan?.reservedCredits;
    const dailyCreditBudget = budget?.dailyCreditBudget;
    const monthlyCreditBudget = budget?.monthlyCreditBudget;
    const requestIds = Array.isArray(plan?.requests)
      ? plan.requests.map((item) => clean(item?.id))
      : [];
    const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;
    if (!durableRunId || durableRunId.length > 100
      || !positiveInteger(reservedCredits)
      || !positiveInteger(dailyCreditBudget)
      || !positiveInteger(monthlyCreditBudget)
      || dailyCreditBudget > monthlyCreditBudget
      || reservedCredits > dailyCreditBudget
      || reservedCredits > monthlyCreditBudget
      || !requestIds.length
      || requestIds.length > 16
      || requestIds.some((id) => !id || id.length > 100)
      || typeof plan?.currentDue !== "boolean"
      || typeof plan?.historyDue !== "boolean") {
      throw new Error("cmc_supabase_reservation_invalid");
    }
    const body = {
      p_run_id: durableRunId,
      p_reserved_credits: reservedCredits,
      p_daily_credit_budget: dailyCreditBudget,
      p_monthly_credit_budget: monthlyCreditBudget,
      p_request_ids: requestIds,
      p_current_due: plan.currentDue,
      p_history_due: plan.historyDue,
    };
    const rows = await request(CMC_RESERVATION_RPC, {
      method: "POST",
      body,
    });
    const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
    if (!row?.reservation_id
      || typeof row.reservation_created !== "boolean"
      || !row.reservation_started_at
      || !row.reservation_details
      || typeof row.reservation_details !== "object"
      || Array.isArray(row.reservation_details)) {
      throw new Error("cmc_supabase_reservation_invalid");
    }
    if (row.reservation_created !== true) {
      // A prior request may have reached CMC after its RPC response was lost.
      // Never auto-resume provider traffic for an existing reservation.
      throw new Error("cmc_supabase_reservation_replayed");
    }
    return {
      id: row.reservation_id,
      details: row.reservation_details,
      startedAt: row.reservation_started_at,
    };
  }

  async function finish(reservation, {
    status,
    state,
    creditCount,
    error = null,
    currentAttempted = false,
    historyAttempted = false,
    historyDelta = {},
  }) {
    if (!config) throw new Error("cmc_supabase_required");
    if (!reservation?.id || !["completed", "failed"].includes(status)) {
      throw new Error("cmc_supabase_reservation_invalid");
    }
    const current = now();
    const normalized = state ? validateCmcProviderState(state, { now: current }) : null;
    const shouldStoreHistoryDelta = status === "completed"
      && normalized?.refresh?.historyRefreshed === true;
    if (shouldStoreHistoryDelta && historyAttempted !== true) {
      throw new Error("cmc_history_delta_required");
    }
    let normalizedHistoryDelta = {};
    if (shouldStoreHistoryDelta) {
      const stateWithDelta = validateCmcProviderState({
        ...normalized,
        history: historyDelta,
      }, { now: current });
      normalizedHistoryDelta = stateWithDelta.history;
      if (!Object.keys(normalizedHistoryDelta).length) {
        throw new Error("cmc_history_delta_required");
      }
    }
    const compactState = normalized ? validateCmcProviderState({
      ...normalized,
      history: {},
    }, { now: current }) : null;
    const details = {
      ...reservation.details,
      result: {
        creditCount: safeInteger(creditCount),
        errorCode: error ? genericErrorCode(error) : null,
        currentAttempted: currentAttempted === true,
        historyAttempted: historyAttempted === true,
      },
      ...(shouldStoreHistoryDelta ? { cmcHistoryDelta: normalizedHistoryDelta } : {}),
      ...(compactState ? { cmcProviderState: compactState } : {}),
    };
    const observedAt = compactState?.current?.global?.observedAt || null;
    const body = {
      status,
      observation_count: Object.values(normalizedHistoryDelta).reduce((sum, points) => sum + points.length, 0),
      source_observed_at: observedAt,
      source_fetched_at: compactState?.current?.fetchedAt || null,
      transformed_at: compactState?.updatedAt || new Date(current).toISOString(),
      completed_at: new Date(current).toISOString(),
      error_code: error ? genericErrorCode(error) : null,
      details,
    };
    assertRunPatchSize(body);
    const query = new URLSearchParams({
      id: `eq.${reservation.id}`,
      projection_id: `eq.${PROJECTION_ID}`,
      status: "eq.started",
      select: "id,status",
    });
    let rows = null;
    let patchFailure = null;
    try {
      rows = await request(`${DASHBOARD_RUNS_TABLE}?${query}`, {
        method: "PATCH",
        body,
        prefer: "return=representation",
      });
    } catch (cause) {
      patchFailure = cause;
    }
    const exactTransition = Array.isArray(rows)
      && rows.length === 1
      && String(rows[0]?.id) === String(reservation.id)
      && rows[0]?.status === status;
    if (exactTransition) return rows[0];

    const verifyQuery = new URLSearchParams({
      select: "id,status",
      id: `eq.${reservation.id}`,
      projection_id: `eq.${PROJECTION_ID}`,
      limit: "2",
    });
    let verified;
    try {
      verified = await request(`${DASHBOARD_RUNS_TABLE}?${verifyQuery}`);
    } catch {
      throw new Error(patchFailure
        ? "cmc_supabase_reservation_update_ambiguous"
        : "cmc_supabase_reservation_update_invalid");
    }
    if (Array.isArray(verified)
      && verified.length === 1
      && String(verified[0]?.id) === String(reservation.id)) {
      if (verified[0]?.status === status) return verified[0];
      if (["completed", "failed"].includes(verified[0]?.status)) {
        throw new Error("cmc_supabase_reservation_terminal_conflict");
      }
    }
    throw new Error(patchFailure
      ? "cmc_supabase_reservation_update_ambiguous"
      : "cmc_supabase_reservation_update_invalid");
  }

  return Object.freeze({
    remoteAvailable: Boolean(config),
    load,
    reserve,
    finish,
    saveLocal(state) {
      return writeLocalCmcProviderState(workspaceRoot, state, { now: now() });
    },
  });
}

export function cmcBudgetWithLedger(budgets, ledger, now = new Date()) {
  return budgetForNow({ budgets, ledger, now });
}
