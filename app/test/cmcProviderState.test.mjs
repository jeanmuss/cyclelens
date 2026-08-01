import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  CMC_HISTORY_MIN_INTERVAL_MS,
  CMC_PROVIDER_ASSETS,
  CMC_PROVIDER_STATE_VERSION,
  budgetForNow,
  cmcLiquidityFromProviderState,
  cmcProviderStatePath,
  creditCountFromCmcPayload,
  normalizeCmcCurrentPayloads,
  parseRequiredCmcBudgets,
  planCmcProviderRefresh,
  validateCmcProviderState,
} from "../scripts/cmc-provider-state-contract.mjs";
import {
  createCmcProviderStateStore,
} from "../scripts/cmc-provider-state-store.mjs";
import {
  refreshCmcProviderState,
} from "../scripts/refresh-cmc-provider-state.mjs";

const NOW = "2026-07-31T12:00:00.000Z";
const DAY_MS = 86_400_000;

function asset(symbol, overrides = {}) {
  const definition = CMC_PROVIDER_ASSETS[symbol];
  return {
    id: definition.id,
    symbol,
    priceUsd: symbol === "USDT" ? 0.9995 : 100,
    marketCapUsd: 1_000 + definition.id,
    percentChange24h: 1.5,
    observedAt: "2026-07-31T11:55:00.000Z",
    ...overrides,
  };
}

function stateFixture(overrides = {}) {
  const base = {
    version: CMC_PROVIDER_STATE_VERSION,
    provider: "coinmarketcap",
    dataUseScope: "owner_private",
    updatedAt: "2026-07-31T11:56:00.000Z",
    current: {
      fetchedAt: "2026-07-31T11:56:00.000Z",
      global: {
        totalMarketCapUsd: 3_000_000,
        totalMarketCapYesterdayUsd: 2_900_000,
        totalMarketCapChangePct24h: 3.45,
        observedAt: "2026-07-31T11:55:00.000Z",
      },
      assets: Object.fromEntries(Object.keys(CMC_PROVIDER_ASSETS).map((symbol) => [symbol, asset(symbol)])),
    },
    history: {},
    watermarks: {
      lastAttemptedAt: "2026-07-31T11:56:00.000Z",
      lastSuccessfulAt: "2026-07-31T11:56:00.000Z",
      lastHistoryAttemptedAt: "2026-07-31T11:56:00.000Z",
      lastHistorySuccessfulAt: "2026-07-31T11:56:00.000Z",
    },
    budget: {
      utcDay: "2026-07-31",
      utcMonth: "2026-07",
      dailyCreditBudget: 50,
      monthlyCreditBudget: 500,
      dailyCreditsReserved: 2,
      monthlyCreditsReserved: 20,
    },
    refresh: {
      mode: "refreshed",
      networkRequests: 2,
      creditCount: 2,
      currentRefreshed: true,
      historyRefreshed: false,
    },
  };
  return {
    ...base,
    ...overrides,
    current: overrides.current === null ? null : { ...base.current, ...(overrides.current || {}) },
    watermarks: { ...base.watermarks, ...(overrides.watermarks || {}) },
    budget: { ...base.budget, ...(overrides.budget || {}) },
    refresh: { ...base.refresh, ...(overrides.refresh || {}) },
  };
}

function disabledStateFixture() {
  return stateFixture({
    current: null,
    refresh: {
      mode: "disabled",
      networkRequests: 0,
      creditCount: 0,
      currentRefreshed: false,
      historyRefreshed: false,
    },
  });
}

function currentPayloads() {
  const observedAt = "2026-07-31T11:58:00.000Z";
  const global = {
    status: { timestamp: observedAt, credit_count: 1, secret_echo: "must-not-persist" },
    data: {
      quote: {
        USD: {
          total_market_cap: 4_000_000,
          total_market_cap_yesterday: 3_900_000,
          total_market_cap_yesterday_percentage_change: 2.56,
          last_updated: observedAt,
          raw_provider_field: "drop-me",
        },
      },
    },
  };
  const assets = {
    status: { timestamp: observedAt, credit_count: 1 },
    data: Object.fromEntries(Object.entries(CMC_PROVIDER_ASSETS).map(([symbol, definition]) => [
      String(definition.id),
      {
        id: definition.id,
        symbol,
        name: `raw-${symbol}`,
        quote: {
          USD: {
            price: symbol === "USDT" ? 0.999 : 200 + definition.id,
            market_cap: 10_000 + definition.id,
            percent_change_24h: 2,
            last_updated: observedAt,
            volume_24h: 999,
          },
        },
      },
    ])),
  };
  return { global, assets };
}

function historyPayloads() {
  const observedAt = "2026-07-30T00:00:00.000Z";
  const quote = (marketCap, price = 1) => ({
    timestamp: observedAt,
    quote: { USD: { market_cap: marketCap, price } },
  });
  return {
    global: {
      status: { timestamp: NOW, credit_count: 1 },
      data: { quotes: [{ timestamp: observedAt, quote: { USD: { total_market_cap: 4_000_000 } } }] },
    },
    assets: {
      status: { timestamp: NOW, credit_count: 1 },
      data: {
        1: { id: 1, quotes: [quote(2_000_000, 120_000)] },
        825: { id: 825, quotes: [quote(190_000, 0.999)] },
        3408: { id: 3408, quotes: [quote(70_000, 1)] },
      },
    },
  };
}

function historyFixture(count = 400, { metricId = "btc.marketCap", end = "2026-07-30" } = {}) {
  const endTime = Date.parse(`${end}T00:00:00.000Z`);
  return {
    [metricId]: Array.from({ length: count }, (_, index) => {
      const date = new Date(endTime - (count - index - 1) * DAY_MS).toISOString().slice(0, 10);
      return {
        date,
        value: 1_000_000 + index,
        observedAt: `${date}T00:00:00.000Z`,
        fetchedAt: NOW,
        lastCheckedAt: NOW,
        sourceUrl: "https://coinmarketcap.com/api/documentation/pro-api-reference/cryptocurrency",
        qualityStatus: "provider_reported",
      };
    }),
  };
}

function enabledEnvironment(overrides = {}) {
  return {
    CYCLELENS_COLLECT_CMC: "true",
    CYCLELENS_DATA_USE_SCOPE: "owner_private",
    CYCLELENS_OWNER_PRIVATE_USE_APPROVED: "1",
    CYCLELENS_CMC_DAILY_CREDIT_BUDGET: "50",
    CYCLELENS_CMC_MONTHLY_CREDIT_BUDGET: "500",
    CMC_PRO_API_KEY: "unit-test-key",
    ...overrides,
  };
}

function fakeStore({
  state,
  history = state?.history || {},
  ledger = {},
  remoteAvailable = true,
  onFinish = null,
  onSaveLocal = null,
} = {}) {
  const events = [];
  const finishInputs = [];
  return {
    events,
    finishInputs,
    async load() {
      events.push("load");
      return {
        state,
        history,
        watermarks: state?.watermarks || {},
        ledger: { dailyCreditsReserved: 0, monthlyCreditsReserved: 0, ...ledger },
        remoteAvailable,
      };
    },
    async reserve(input) {
      events.push("reserve");
      return { id: 7, details: { reservation: input.plan.reservedCredits } };
    },
    async finish(reservation, input) {
      events.push(`finish:${input.status}`);
      finishInputs.push(structuredClone(input));
      return onFinish?.(reservation, input);
    },
    async saveLocal(nextState) {
      events.push("save");
      return onSaveLocal?.(nextState);
    },
  };
}

test("provider state validation keeps only the derived whitelist and exposes the consumer contract", () => {
  const candidate = stateFixture({ extraRoot: "drop" });
  candidate.current.assets.BTC.cookie = "drop";
  candidate.current.global.raw = { response: "drop" };
  candidate.history = {
    "btc.marketCap": [{
      date: "2026-07-30",
      value: 2_000_000,
      observedAt: "2026-07-30T00:00:00.000Z",
      fetchedAt: "2026-07-31T01:00:00.000Z",
      sourceUrl: "https://evil.example/injected",
      qualityStatus: "<script>untrusted</script>",
    }],
  };
  const state = validateCmcProviderState(candidate, { now: NOW });
  assert.equal(state.extraRoot, undefined);
  assert.equal(state.current.assets.BTC.cookie, undefined);
  assert.equal(state.current.global.raw, undefined);
  assert.equal(
    state.history["btc.marketCap"][0].sourceUrl,
    "https://coinmarketcap.com/api/documentation/pro-api-reference/",
  );
  assert.equal(state.history["btc.marketCap"][0].qualityStatus, "provider_reported");
  assert.deepEqual(Object.keys(state.current.assets).sort(), Object.keys(CMC_PROVIDER_ASSETS).sort());

  const liquidity = cmcLiquidityFromProviderState(state);
  assert.equal(liquidity.currentAvailable, true);
  assert.equal(liquidity.metrics.length, 6);
  assert.equal(liquidity.spotPrices.BTC.priceUsd, state.current.assets.BTC.priceUsd);
  assert.equal(liquidity.historyRefresh.lastAttemptedAt, state.watermarks.lastHistoryAttemptedAt);
  assert.equal(liquidity.historyRefresh.lastSuccessfulAt, state.watermarks.lastHistorySuccessfulAt);
  assert.equal(liquidity.refreshMode, "refreshed");
});

test("only an explicit disabled state may omit the complete six-asset current snapshot", () => {
  const disabled = validateCmcProviderState(disabledStateFixture(), { now: NOW });
  const liquidity = cmcLiquidityFromProviderState(disabled);
  assert.equal(liquidity.currentAvailable, false);
  assert.deepEqual(liquidity.metrics, []);
  assert.deepEqual(liquidity.spotPrices, {});

  assert.throws(
    () => validateCmcProviderState(stateFixture({ current: null, refresh: { mode: "hydrated" } }), { now: NOW }),
    /cmc_state_current_required/,
  );
  const incomplete = stateFixture();
  delete incomplete.current.assets.HYPE;
  assert.throws(() => validateCmcProviderState(incomplete, { now: NOW }), /cmc_state_assets_incomplete/);
  assert.throws(
    () => validateCmcProviderState({ ...stateFixture(), dataUseScope: "public" }, { now: NOW }),
    /cmc_state_identity_invalid/,
  );
});

test("fixed state path stays in the ignored owner-private provider directory", () => {
  const workspace = resolve("C:/workspace/cycle-map");
  assert.equal(
    cmcProviderStatePath(workspace),
    resolve(workspace, "tmp", "owner-private", "provider-state", "coinmarketcap.json"),
  );
});

test("budgets are mandatory, positive, safe, and daily cannot exceed monthly", () => {
  assert.deepEqual(parseRequiredCmcBudgets({
    CYCLELENS_CMC_DAILY_CREDIT_BUDGET: "10",
    CYCLELENS_CMC_MONTHLY_CREDIT_BUDGET: "100",
  }), { dailyCreditBudget: 10, monthlyCreditBudget: 100 });
  for (const environment of [
    {},
    { CYCLELENS_CMC_DAILY_CREDIT_BUDGET: "0", CYCLELENS_CMC_MONTHLY_CREDIT_BUDGET: "100" },
    { CYCLELENS_CMC_DAILY_CREDIT_BUDGET: "10", CYCLELENS_CMC_MONTHLY_CREDIT_BUDGET: "9" },
    { CYCLELENS_CMC_DAILY_CREDIT_BUDGET: "1.5", CYCLELENS_CMC_MONTHLY_CREDIT_BUDGET: "100" },
  ]) {
    assert.throws(() => parseRequiredCmcBudgets(environment), /cmc_budget/);
  }
});

test("current planning uses at most two requests and budget exhaustion makes zero calls", () => {
  const old = stateFixture({
    watermarks: {
      lastAttemptedAt: "2026-07-31T05:00:00.000Z",
      lastHistoryAttemptedAt: "2026-07-31T11:00:00.000Z",
    },
  });
  const openBudget = budgetForNow({
    budgets: { dailyCreditBudget: 10, monthlyCreditBudget: 100 },
    ledger: { dailyCreditsReserved: 0, monthlyCreditsReserved: 0 },
    now: NOW,
  });
  const plan = planCmcProviderRefresh({ state: old, budget: openBudget, now: NOW });
  assert.equal(plan.requests.filter((request) => request.kind.startsWith("current_")).length, 2);
  assert.match(plan.requests[1].url, /id=1%2C1027%2C825%2C3408%2C32196%2C1839|id=1,1027,825,3408,32196,1839/);

  const closedBudget = { ...openBudget, dailyCreditsReserved: 9 };
  const guarded = planCmcProviderRefresh({ state: old, budget: closedBudget, now: NOW });
  assert.equal(guarded.currentGuarded, true);
  assert.equal(guarded.requests.length, 0);
});

test("history cadence is fixed at twenty hours and cannot be lowered by environment configuration", () => {
  assert.equal(CMC_HISTORY_MIN_INTERVAL_MS, 20 * 60 * 60 * 1000);
  const recent = stateFixture({
    watermarks: {
      lastAttemptedAt: "2026-07-31T11:00:00.000Z",
      lastHistoryAttemptedAt: new Date(Date.parse(NOW) - 19 * 60 * 60 * 1000).toISOString(),
    },
  });
  const budget = budgetForNow({
    budgets: { dailyCreditBudget: 100, monthlyCreditBudget: 1000 },
    ledger: {},
    now: NOW,
  });
  const guarded = planCmcProviderRefresh({ state: recent, budget, now: NOW });
  assert.equal(guarded.requests.length, 0);

  const due = structuredClone(recent);
  due.watermarks.lastHistoryAttemptedAt = new Date(Date.parse(NOW) - 21 * 60 * 60 * 1000).toISOString();
  const plan = planCmcProviderRefresh({ state: due, budget, now: NOW });
  assert.equal(plan.requests.filter((request) => request.kind.startsWith("history_")).length, 2);
});

test("current normalization requires all six assets, parses credits, and drops raw provider fields", () => {
  const payloads = currentPayloads();
  const current = normalizeCmcCurrentPayloads(payloads.global, payloads.assets, NOW);
  assert.equal(current.global.totalMarketCapUsd, 4_000_000);
  assert.equal(current.assets.HYPE.id, CMC_PROVIDER_ASSETS.HYPE.id);
  assert.equal(current.assets.BTC.name, undefined);
  assert.equal(JSON.stringify(current).includes("must-not-persist"), false);
  assert.equal(JSON.stringify(current).includes("volume_24h"), false);
  assert.equal(creditCountFromCmcPayload(payloads.global), 1);
  assert.throws(() => creditCountFromCmcPayload({ status: {} }), /cmc_credit_count_invalid/);
  assert.throws(
    () => creditCountFromCmcPayload({ status: { credit_count: null } }),
    /cmc_credit_count_invalid/,
  );
  assert.throws(
    () => creditCountFromCmcPayload({ status: { credit_count: "1" } }),
    /cmc_credit_count_invalid/,
  );

  delete payloads.assets.data[String(CMC_PROVIDER_ASSETS.BNB.id)];
  assert.throws(
    () => normalizeCmcCurrentPayloads(payloads.global, payloads.assets, NOW),
    /cmc_current_incomplete/,
  );
});

test("the independent switch is strict and disabled mode hydrates LKG without reservation or network", async () => {
  let providerTouched = false;
  const store = fakeStore({ state: null, remoteAvailable: false });
  const result = await refreshCmcProviderState({
    environment: {
      CYCLELENS_COLLECT_CMC: "false",
      CYCLELENS_DATA_USE_SCOPE: "owner_private",
      CYCLELENS_OWNER_PRIVATE_USE_APPROVED: "1",
    },
    store,
    requestCmc: async () => { providerTouched = true; throw new Error("unexpected"); },
  });
  assert.equal(result.status, "disabled");
  assert.equal(providerTouched, false);
  assert.deepEqual(store.events, ["load"]);
  await assert.rejects(
    refreshCmcProviderState({ environment: {}, store }),
    /cmc_collection_opt_in_invalid/,
  );
});

test("public or unapproved scope fails before storage and provider access", async () => {
  let touched = false;
  const store = { async load() { touched = true; } };
  await assert.rejects(refreshCmcProviderState({
    environment: enabledEnvironment({ CYCLELENS_DATA_USE_SCOPE: "public" }),
    store,
    requestCmc: async () => { touched = true; },
  }), /cmc_owner_private_boundary_required/);
  assert.equal(touched, false);
});

test("without Supabase the coordinator is local-LKG-only and cannot spend budget", async () => {
  const state = stateFixture();
  const store = fakeStore({ state, remoteAvailable: false });
  let calls = 0;
  const result = await refreshCmcProviderState({
    environment: enabledEnvironment(),
    store,
    requestCmc: async () => { calls += 1; throw new Error("unexpected"); },
    now: () => new Date(NOW),
  });
  assert.equal(result.status, "local_lkg_only");
  assert.equal(result.state.current.fetchedAt, state.current.fetchedAt);
  assert.equal(calls, 0);
  await assert.rejects(refreshCmcProviderState({
    environment: enabledEnvironment(),
    store: fakeStore({ state: null, remoteAvailable: false }),
    now: () => new Date(NOW),
  }), /cmc_local_lkg_required/);
});

test("an ambiguous replayed reservation stops before any CMC request", async () => {
  const previous = stateFixture({
    watermarks: {
      lastAttemptedAt: "2026-07-31T05:00:00.000Z",
      lastSuccessfulAt: "2026-07-31T05:00:00.000Z",
      lastHistoryAttemptedAt: "2026-07-31T11:00:00.000Z",
      lastHistorySuccessfulAt: "2026-07-31T11:00:00.000Z",
    },
  });
  const store = fakeStore({ state: previous });
  store.reserve = async () => {
    store.events.push("reserve");
    throw new Error("cmc_supabase_reservation_replayed");
  };
  let providerTouched = false;
  await assert.rejects(refreshCmcProviderState({
    environment: enabledEnvironment(),
    store,
    now: () => new Date(NOW),
    requestCmc: async () => {
      providerTouched = true;
      throw new Error("unexpected");
    },
  }), /cmc_supabase_reservation_replayed/);
  assert.equal(providerTouched, false);
  assert.deepEqual(store.events, ["load", "reserve"]);
});

test("reservation is persisted before exactly two current calls and actual credits complete the ledger", async () => {
  const previous = stateFixture({
    watermarks: {
      lastAttemptedAt: "2026-07-31T05:00:00.000Z",
      lastSuccessfulAt: "2026-07-31T05:00:00.000Z",
      lastHistoryAttemptedAt: "2026-07-31T11:00:00.000Z",
      lastHistorySuccessfulAt: "2026-07-31T11:00:00.000Z",
    },
  });
  const store = fakeStore({ state: previous });
  const payloads = currentPayloads();
  let calls = 0;
  const result = await refreshCmcProviderState({
    environment: enabledEnvironment(),
    store,
    now: () => new Date(NOW),
    requestCmc: async (_url, { request }) => {
      assert.equal(store.events.includes("reserve"), true, "reservation must precede provider access");
      calls += 1;
      return request.kind === "current_global" ? payloads.global : payloads.assets;
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.networkRequests, 2);
  assert.equal(result.creditCount, 2);
  assert.equal(result.state.refresh.currentRefreshed, true);
  assert.equal(result.state.refresh.historyRefreshed, false);
  assert.equal(result.state.current.assets.BNB.marketCapUsd, 10_000 + CMC_PROVIDER_ASSETS.BNB.id);
  assert.deepEqual(store.events, ["load", "reserve", "finish:completed", "save"]);
});

test("a failure on the second current request charges conservatively and keeps the previous LKG", async () => {
  const previous = stateFixture({
    watermarks: {
      lastAttemptedAt: "2026-07-31T05:00:00.000Z",
      lastSuccessfulAt: "2026-07-31T05:00:00.000Z",
      lastHistoryAttemptedAt: "2026-07-31T11:00:00.000Z",
      lastHistorySuccessfulAt: "2026-07-31T11:00:00.000Z",
    },
  });
  const store = fakeStore({ state: previous });
  const payloads = currentPayloads();
  const kinds = [];
  const result = await refreshCmcProviderState({
    environment: enabledEnvironment(),
    store,
    now: () => new Date(NOW),
    requestCmc: async (_url, { request }) => {
      kinds.push(request.kind);
      if (request.kind === "current_global") return payloads.global;
      const failure = new Error("provider_http_503");
      failure.code = "provider_http_503";
      throw failure;
    },
  });
  assert.deepEqual(kinds, ["current_global", "current_assets"]);
  assert.equal(result.status, "provider_failed_lkg");
  assert.equal(result.networkRequests, 2);
  assert.equal(result.creditCount, 1);
  assert.equal(result.state.current.fetchedAt, previous.current.fetchedAt);
  assert.equal(result.state.refresh.currentRefreshed, false);
  assert.equal(result.state.watermarks.lastSuccessfulAt, previous.watermarks.lastSuccessfulAt);
  assert.equal(store.finishInputs[0].status, "failed");
  assert.equal(store.finishInputs[0].creditCount, 1);
});

test("a due history refresh uses at most two requests while retaining the current LKG", async () => {
  const previous = stateFixture({
    watermarks: {
      lastAttemptedAt: "2026-07-31T11:00:00.000Z",
      lastSuccessfulAt: "2026-07-31T11:00:00.000Z",
      lastHistoryAttemptedAt: "2026-07-30T12:00:00.000Z",
      lastHistorySuccessfulAt: "2026-07-30T12:00:00.000Z",
    },
  });
  const store = fakeStore({ state: previous });
  const payloads = historyPayloads();
  const kinds = [];
  const result = await refreshCmcProviderState({
    environment: enabledEnvironment({
      CYCLELENS_CMC_DAILY_CREDIT_BUDGET: "100",
      CYCLELENS_CMC_MONTHLY_CREDIT_BUDGET: "1000",
      CYCLELENS_CMC_HISTORY_MIN_INTERVAL_MINUTES: "1",
    }),
    store,
    now: () => new Date(NOW),
    requestCmc: async (_url, { request }) => {
      kinds.push(request.kind);
      return request.kind === "history_global" ? payloads.global : payloads.assets;
    },
  });
  assert.deepEqual(kinds, ["history_global", "history_assets"]);
  assert.equal(result.state.current.fetchedAt, previous.current.fetchedAt);
  assert.equal(result.state.refresh.currentRefreshed, false);
  assert.equal(result.state.refresh.historyRefreshed, true);
  assert.equal(result.state.history["stablecoin.major.marketCap"][0].value, 260_000);
  assert.equal(result.state.watermarks.lastHistorySuccessfulAt, NOW);
  assert.equal(store.finishInputs.length, 1);
  assert.deepEqual(
    store.finishInputs[0].historyDelta,
    Object.fromEntries(Object.entries(result.state.history).map(([metricId, points]) => [
      metricId,
      points.filter((point) => point.date === "2026-07-30"),
    ])),
    "the coordinator must pass only this run's normalized history delta to the ledger",
  );
});

test("the first run retains a newly successful current snapshot when a later history request fails", async () => {
  const store = fakeStore({ state: null, history: {} });
  const current = currentPayloads();
  const historical = historyPayloads();
  const kinds = [];
  const result = await refreshCmcProviderState({
    environment: enabledEnvironment({
      CYCLELENS_CMC_DAILY_CREDIT_BUDGET: "100",
      CYCLELENS_CMC_MONTHLY_CREDIT_BUDGET: "1000",
    }),
    store,
    now: () => new Date(NOW),
    requestCmc: async (_url, { request }) => {
      kinds.push(request.kind);
      if (request.kind === "current_global") return current.global;
      if (request.kind === "current_assets") return current.assets;
      if (request.kind === "history_global") return historical.global;
      const failure = new Error("provider_http_503");
      failure.code = "provider_http_503";
      throw failure;
    },
  });
  assert.deepEqual(kinds, ["current_global", "current_assets", "history_global", "history_assets"]);
  assert.equal(result.status, "provider_failed_lkg");
  assert.equal(result.networkRequests, 4);
  assert.equal(result.creditCount, 3);
  assert.equal(result.state.current.fetchedAt, NOW);
  assert.equal(result.state.current.assets.BNB.marketCapUsd, 10_000 + CMC_PROVIDER_ASSETS.BNB.id);
  assert.equal(result.state.refresh.currentRefreshed, true);
  assert.equal(result.state.refresh.historyRefreshed, false);
  assert.equal(result.state.watermarks.lastAttemptedAt, NOW);
  assert.equal(result.state.watermarks.lastSuccessfulAt, NOW);
  assert.equal(result.state.watermarks.lastHistoryAttemptedAt, NOW);
  assert.equal(result.state.watermarks.lastHistorySuccessfulAt, null);
  assert.deepEqual(result.state.history, {});
  assert.equal(store.finishInputs[0].status, "failed");
  assert.equal(store.finishInputs[0].state.current.fetchedAt, NOW);
});

test("a completed ledger PATCH failure falls back through failed while preserving the new current LKG", async () => {
  const previous = stateFixture({
    watermarks: {
      lastAttemptedAt: "2026-07-31T05:00:00.000Z",
      lastSuccessfulAt: "2026-07-31T05:00:00.000Z",
      lastHistoryAttemptedAt: "2026-07-31T11:00:00.000Z",
      lastHistorySuccessfulAt: "2026-07-31T11:00:00.000Z",
    },
  });
  const store = fakeStore({
    state: previous,
    onFinish: async (_reservation, input) => {
      if (input.status === "completed") throw new Error("cmc_supabase_reservation_update_invalid");
    },
  });
  const payloads = currentPayloads();
  const result = await refreshCmcProviderState({
    environment: enabledEnvironment(),
    store,
    now: () => new Date(NOW),
    requestCmc: async (_url, { request }) => (
      request.kind === "current_global" ? payloads.global : payloads.assets
    ),
  });
  assert.equal(result.status, "provider_failed_lkg");
  assert.equal(result.state.current.fetchedAt, NOW);
  assert.equal(result.state.refresh.currentRefreshed, true);
  assert.equal(result.state.watermarks.lastSuccessfulAt, NOW);
  assert.deepEqual(store.events, [
    "load",
    "reserve",
    "finish:completed",
    "finish:failed",
    "save",
  ]);
  assert.deepEqual(store.finishInputs.map((input) => input.status), ["completed", "failed"]);
});

test("a local write failure after completed persistence never rewrites the terminal row as failed", async () => {
  const previous = stateFixture({
    watermarks: {
      lastAttemptedAt: "2026-07-31T05:00:00.000Z",
      lastSuccessfulAt: "2026-07-31T05:00:00.000Z",
      lastHistoryAttemptedAt: "2026-07-31T11:00:00.000Z",
      lastHistorySuccessfulAt: "2026-07-31T11:00:00.000Z",
    },
  });
  const store = fakeStore({
    state: previous,
    onSaveLocal: async () => { throw new Error("cmc_local_state_write_failed"); },
  });
  const payloads = currentPayloads();
  await assert.rejects(refreshCmcProviderState({
    environment: enabledEnvironment(),
    store,
    now: () => new Date(NOW),
    requestCmc: async (_url, { request }) => (
      request.kind === "current_global" ? payloads.global : payloads.assets
    ),
  }), /cmc_local_state_write_failed/);
  assert.deepEqual(store.events, ["load", "reserve", "finish:completed", "save"]);
  assert.deepEqual(store.finishInputs.map((input) => input.status), ["completed"]);
});

test("429 or any provider failure opens the breaker, advances only attempted watermarks, and serves LKG", async () => {
  const previous = stateFixture({
    watermarks: {
      lastAttemptedAt: "2026-07-31T05:00:00.000Z",
      lastSuccessfulAt: "2026-07-31T05:00:00.000Z",
      lastHistoryAttemptedAt: "2026-07-30T10:00:00.000Z",
      lastHistorySuccessfulAt: "2026-07-30T10:00:00.000Z",
    },
  });
  const store = fakeStore({ state: previous });
  let calls = 0;
  const result = await refreshCmcProviderState({
    environment: enabledEnvironment({
      CYCLELENS_CMC_DAILY_CREDIT_BUDGET: "100",
      CYCLELENS_CMC_MONTHLY_CREDIT_BUDGET: "1000",
    }),
    store,
    now: () => new Date(NOW),
    requestCmc: async () => {
      calls += 1;
      const failure = new Error("provider_http_429");
      failure.code = "provider_http_429";
      throw failure;
    },
  });
  assert.equal(calls, 1, "the first failure must stop current and history requests");
  assert.equal(result.status, "provider_failed_lkg");
  assert.equal(result.state.current.fetchedAt, previous.current.fetchedAt);
  assert.equal(result.state.watermarks.lastAttemptedAt, NOW);
  assert.equal(result.state.watermarks.lastSuccessfulAt, previous.watermarks.lastSuccessfulAt);
  assert.equal(
    result.state.watermarks.lastHistoryAttemptedAt,
    previous.watermarks.lastHistoryAttemptedAt,
    "history was planned but never attempted after the current breaker opened",
  );
  assert.deepEqual(store.events, ["load", "reserve", "finish:failed", "save"]);
});

test("Supabase credit reservation uses the atomic RPC and fails closed on replay or budget rejection", async () => {
  const plan = {
    reservedCredits: 2,
    requests: [{ id: "current_global" }, { id: "current_assets" }],
    currentDue: true,
    historyDue: false,
  };
  const budget = {
    utcDay: "2026-07-31",
    utcMonth: "2026-07",
    dailyCreditBudget: 50,
    monthlyCreditBudget: 500,
  };
  const rpcDetails = {
    dataUseScope: "owner_private",
    runId: "github-123-1",
    startedAt: NOW,
    reservation: {
      utcDay: "2026-07-31",
      utcMonth: "2026-07",
      creditsReserved: 2,
      dailyCreditBudget: 50,
      monthlyCreditBudget: 500,
    },
    plan: {
      requestIds: ["current_global", "current_assets"],
      currentDue: true,
      historyDue: false,
    },
  };
  const requests = [];
  const store = createCmcProviderStateStore({
    workspaceRoot: resolve("C:/workspace/cycle-map-atomic-reservation"),
    environment: {
      SUPABASE_URL: "https://unit-test.supabase.co",
      SUPABASE_SECRET_KEY: "sb_secret_unit_test",
    },
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options, body: JSON.parse(options.body) });
      return new Response(JSON.stringify([{
        reservation_id: 44,
        reservation_created: true,
        reservation_started_at: NOW,
        reservation_details: rpcDetails,
      }]), { status: 200 });
    },
  });
  const reservation = await store.reserve({ runId: "github-123-1", plan, budget });
  assert.equal(reservation.id, 44);
  assert.deepEqual(reservation.details, rpcDetails);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://unit-test.supabase.co/rest/v1/rpc/reserve_cmc_provider_credits");
  assert.equal(requests[0].options.method, "POST");
  assert.deepEqual(requests[0].body, {
    p_run_id: "github-123-1",
    p_reserved_credits: 2,
    p_daily_credit_budget: 50,
    p_monthly_credit_budget: 500,
    p_request_ids: ["current_global", "current_assets"],
    p_current_due: true,
    p_history_due: false,
  });
  assert.equal(Object.hasOwn(requests[0].options.headers, "Prefer"), false);

  const replayStore = createCmcProviderStateStore({
    workspaceRoot: resolve("C:/workspace/cycle-map-replayed-reservation"),
    environment: {
      SUPABASE_URL: "https://unit-test.supabase.co",
      SUPABASE_SECRET_KEY: "sb_secret_unit_test",
    },
    fetchImpl: async () => new Response(JSON.stringify([{
      reservation_id: 44,
      reservation_created: false,
      reservation_started_at: NOW,
      reservation_details: rpcDetails,
    }]), { status: 200 }),
  });
  await assert.rejects(
    replayStore.reserve({ runId: "github-123-1", plan, budget }),
    /cmc_supabase_reservation_replayed/,
  );

  let budgetCalls = 0;
  const budgetRejectedStore = createCmcProviderStateStore({
    workspaceRoot: resolve("C:/workspace/cycle-map-budget-rejected"),
    environment: {
      SUPABASE_URL: "https://unit-test.supabase.co",
      SUPABASE_SECRET_KEY: "sb_secret_unit_test",
    },
    fetchImpl: async (url) => {
      budgetCalls += 1;
      assert.equal(String(url), "https://unit-test.supabase.co/rest/v1/rpc/reserve_cmc_provider_credits");
      return new Response(JSON.stringify({ message: "cmc_daily_budget_exceeded" }), { status: 400 });
    },
  });
  await assert.rejects(
    budgetRejectedStore.reserve({ runId: "github-124-1", plan, budget }),
    /provider_http_400/,
  );
  assert.equal(budgetCalls, 1, "a rejected atomic reservation must not fall back to a table insert");
});

test("CMC reservation migration serializes the ledger and exposes only a service-role RPC", async () => {
  const sql = await readFile(new URL(
    "../../supabase/migrations/20260801000000_cmc_atomic_budget_reservation.sql",
    import.meta.url,
  ), "utf8");
  assert.match(sql, /create unique index[\s\S]+details\s*->>\s*'runId'/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /security invoker[\s\S]+set search_path = pg_catalog, pg_temp/i);
  assert.doesNotMatch(sql, /security definer/i);
  assert.match(sql, /status = 'completed' then coalesce\(actual, reserved\)/i);
  assert.match(sql, /else greatest\(reserved, coalesce\(actual, 0\)\)/i);
  assert.match(sql, /cmc_daily_budget_exceeded/);
  assert.match(sql, /cmc_monthly_budget_exceeded/);
  assert.match(sql, /from public, anon, authenticated, service_role/i);
  assert.match(sql, /grant execute[\s\S]+to service_role/i);
  assert.doesNotMatch(sql, /grant execute[\s\S]+to (?:anon|authenticated)/i);
});

test("Supabase state store restores LKG and reservation ledger through strict service-only requests", async () => {
  const state = stateFixture();
  const requests = [];
  const runRows = [
    {
      id: 1,
      status: "completed",
      created_at: "2026-07-31T05:00:00.000Z",
      details: {
        startedAt: "2026-07-31T05:00:00.000Z",
        reservation: { utcDay: "2026-07-31", utcMonth: "2026-07", creditsReserved: 2 },
        result: { creditCount: 2, currentAttempted: true, historyAttempted: false },
        cmcProviderState: state,
      },
    },
    {
      id: 2,
      status: "started",
      created_at: "2026-07-31T11:00:00.000Z",
      details: {
        startedAt: "2026-07-31T11:00:00.000Z",
        reservation: { utcDay: "2026-07-31", utcMonth: "2026-07", creditsReserved: 4 },
        plan: { requestIds: ["history_global", "history_assets"] },
      },
    },
  ];
  const fetchImpl = async (url, options) => {
    const text = String(url);
    const decoded = decodeURIComponent(text);
    requests.push({ url: text, options });
    let body = [];
    if (decoded.includes("cmc_history_delta:details->cmcHistoryDelta")) {
      body = [];
    } else if (text.includes("dashboard_snapshot_runs") && text.includes("created_at=gte.")) {
      body = runRows.map((row) => ({
        id: row.id,
        status: row.status,
        created_at: row.created_at,
        reservation: row.details.reservation,
        result: row.details.result,
        plan: row.details.plan,
        run_started_at: row.details.startedAt,
      }));
    } else if (text.includes("dashboard_snapshot_runs")) {
      body = [runRows[0]];
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const store = createCmcProviderStateStore({
    workspaceRoot: resolve("C:/workspace/cycle-map-test-no-local-state"),
    environment: {
      SUPABASE_URL: "https://unit-test.supabase.co",
      SUPABASE_SECRET_KEY: "sb_secret_unit_test",
    },
    fetchImpl,
    now: () => new Date(NOW),
  });
  const loaded = await store.load();
  assert.equal(loaded.remoteAvailable, true);
  assert.equal(loaded.state.current.assets.BTC.id, 1);
  assert.equal(loaded.ledger.dailyCreditsReserved, 6);
  assert.equal(loaded.ledger.monthlyCreditsReserved, 6);
  assert.equal(
    loaded.watermarks.lastHistoryAttemptedAt,
    "2026-07-31T11:56:00.000Z",
    "the newest valid state watermark must remain monotonic over an older started reservation",
  );
  assert.equal(requests.length, 4);
  assert.ok(requests.every(({ url }) => url.startsWith("https://unit-test.supabase.co/rest/v1/")));
  assert.ok(requests.every(({ options }) => options.headers.apikey === "sb_secret_unit_test"));
  assert.ok(requests.every(({ options }) => options.headers.Authorization === undefined));
  const ledgerUrl = decodeURIComponent(requests.find(({ url }) => url.includes("created_at=gte."))?.url || "");
  assert.match(ledgerUrl, /reservation:details->reservation/);
  assert.match(ledgerUrl, /result:details->result/);
  assert.doesNotMatch(ledgerUrl, /select=id,status,created_at,details(?:&|$)/);
});

test("ledger charges started and failed rows conservatively while completed rows use actual credits", async () => {
  const reservation = {
    utcDay: "2026-07-31",
    utcMonth: "2026-07",
    creditsReserved: 4,
  };
  const ledgerRows = [
    {
      id: 1,
      status: "started",
      created_at: NOW,
      reservation,
      result: { creditCount: 6 },
      run_started_at: NOW,
    },
    {
      id: 2,
      status: "failed",
      created_at: NOW,
      reservation,
      result: { creditCount: 1 },
      run_started_at: NOW,
    },
    {
      id: 3,
      status: "completed",
      created_at: NOW,
      reservation,
      result: { creditCount: 1 },
      run_started_at: NOW,
    },
    {
      id: 4,
      status: "completed",
      created_at: NOW,
      reservation,
      result: { creditCount: -1 },
      run_started_at: NOW,
    },
  ];
  const fetchImpl = async (url) => {
    const text = String(url);
    const decoded = decodeURIComponent(text);
    const body = text.includes("dashboard_snapshot_runs")
      && text.includes("created_at=gte.")
      && !decoded.includes("cmc_history_delta:details->cmcHistoryDelta")
      ? ledgerRows
      : [];
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const store = createCmcProviderStateStore({
    workspaceRoot: resolve("C:/workspace/cycle-map-ledger-charging"),
    environment: {
      SUPABASE_URL: "https://unit-test.supabase.co",
      SUPABASE_SECRET_KEY: "sb_secret_unit_test",
    },
    fetchImpl,
    now: () => new Date(NOW),
  });
  const loaded = await store.load();
  assert.equal(loaded.ledger.dailyCreditsReserved, 15);
  assert.equal(loaded.ledger.monthlyCreditsReserved, 15);
});

test("Supabase run completion stores compact state and only a successful history delta", async () => {
  const fullHistory = historyFixture();
  const delta = { "btc.marketCap": [fullHistory["btc.marketCap"].at(-1)] };
  const patches = [];
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    patches.push(body);
    return new Response(JSON.stringify([{ id: patches.length, status: body.status }]), { status: 200 });
  };
  const store = createCmcProviderStateStore({
    workspaceRoot: resolve("C:/workspace/cycle-map-compact-ledger"),
    environment: {
      SUPABASE_URL: "https://unit-test.supabase.co",
      SUPABASE_SECRET_KEY: "sb_secret_unit_test",
    },
    fetchImpl,
    now: () => new Date(NOW),
  });
  const reservation = (id) => ({
    id,
    details: {
      dataUseScope: "owner_private",
      startedAt: NOW,
      reservation: { utcDay: "2026-07-31", utcMonth: "2026-07", creditsReserved: 2 },
      plan: { requestIds: ["history_global", "history_assets"] },
    },
  });
  const historySuccess = stateFixture({
    history: fullHistory,
    refresh: {
      mode: "refreshed",
      networkRequests: 2,
      creditCount: 2,
      currentRefreshed: false,
      historyRefreshed: true,
    },
  });
  await store.finish(reservation(1), {
    status: "completed",
    state: historySuccess,
    creditCount: 2,
    historyAttempted: true,
    historyDelta: delta,
  });
  await assert.rejects(store.finish(reservation(99), {
    status: "completed",
    state: historySuccess,
    creditCount: 2,
    historyAttempted: true,
  }), /cmc_history_delta_required/);

  const currentOnly = stateFixture({ history: fullHistory });
  await store.finish(reservation(2), {
    status: "completed",
    state: currentOnly,
    creditCount: 2,
    currentAttempted: true,
    historyDelta: delta,
  });

  const failed = stateFixture({
    history: fullHistory,
    refresh: {
      mode: "provider_failed_lkg",
      networkRequests: 1,
      creditCount: 0,
      currentRefreshed: false,
      historyRefreshed: false,
    },
  });
  await store.finish(reservation(3), {
    status: "failed",
    state: failed,
    creditCount: 0,
    historyAttempted: true,
    historyDelta: delta,
  });

  const oversized = reservation(4);
  oversized.details.padding = "x".repeat(4 * 1024 * 1024);
  await assert.rejects(store.finish(oversized, {
    status: "completed",
    state: currentOnly,
    creditCount: 2,
    currentAttempted: true,
  }), /cmc_supabase_run_payload_too_large/);

  assert.equal(patches.length, 3);
  for (const patch of patches) {
    assert.deepEqual(patch.details.cmcProviderState.history, {});
    assert.ok(
      JSON.stringify(patch.details).length < JSON.stringify(fullHistory).length / 4,
      "400 days of full history must not be repeated in each run ledger row",
    );
  }
  assert.equal(patches[0].details.cmcHistoryDelta["btc.marketCap"].length, 1);
  assert.equal(patches[0].details.cmcHistoryDelta["btc.marketCap"][0].date, "2026-07-30");
  assert.equal(patches[0].details.cmcHistoryDelta["btc.marketCap"][0].sourceKey, "cmc");
  assert.equal(patches[0].observation_count, 1);
  assert.equal(Object.hasOwn(patches[1].details, "cmcHistoryDelta"), false);
  assert.equal(Object.hasOwn(patches[2].details, "cmcHistoryDelta"), false);
  assert.equal(patches[1].observation_count, 0);
  assert.equal(patches[2].observation_count, 0);
});

test("finish transitions only started rows and verifies ambiguous responses without overwriting a terminal row", async () => {
  let persistedStatus = "started";
  const patchUrls = [];
  const fetchImpl = async (url, options) => {
    const text = String(url);
    if (options.method === "PATCH") {
      patchUrls.push(decodeURIComponent(text));
      const desired = JSON.parse(options.body).status;
      if (persistedStatus === "started") {
        persistedStatus = desired;
        throw new Error("response_lost_after_commit");
      }
      return new Response("[]", { status: 200 });
    }
    return new Response(JSON.stringify([{ id: 21, status: persistedStatus }]), { status: 200 });
  };
  const store = createCmcProviderStateStore({
    workspaceRoot: resolve("C:/workspace/cycle-map-terminal-transition"),
    environment: {
      SUPABASE_URL: "https://unit-test.supabase.co",
      SUPABASE_SECRET_KEY: "sb_secret_unit_test",
    },
    fetchImpl,
    now: () => new Date(NOW),
  });
  const reservation = {
    id: 21,
    details: {
      dataUseScope: "owner_private",
      startedAt: NOW,
      reservation: { utcDay: "2026-07-31", utcMonth: "2026-07", creditsReserved: 2 },
      plan: { requestIds: ["current_global", "current_assets"] },
    },
  };
  const completed = await store.finish(reservation, {
    status: "completed",
    state: stateFixture(),
    creditCount: 2,
    currentAttempted: true,
  });
  assert.equal(completed.status, "completed", "a lost PATCH response must be verified idempotently");

  const repeated = await store.finish(reservation, {
    status: "completed",
    state: stateFixture(),
    creditCount: 2,
    currentAttempted: true,
  });
  assert.equal(repeated.status, "completed");

  await assert.rejects(store.finish(reservation, {
    status: "failed",
    state: stateFixture({
      refresh: {
        mode: "provider_failed_lkg",
        networkRequests: 1,
        creditCount: 1,
        currentRefreshed: false,
        historyRefreshed: false,
      },
    }),
    creditCount: 1,
    currentAttempted: true,
  }), /cmc_supabase_reservation_terminal_conflict/);
  assert.equal(persistedStatus, "completed");
  assert.equal(patchUrls.length, 3);
  assert.ok(patchUrls.every((url) => url.includes("status=eq.started")));
  assert.ok(patchUrls.every((url) => url.includes("projection_id=eq.cmc-provider-state")));
});

test("Supabase hydration merges compact deltas, legacy full states, and observation history across months", async () => {
  const legacyHistory = historyFixture(1, { end: "2026-07-28" });
  const deltaHistory = historyFixture(1, { end: "2026-07-29" });
  const compactState = stateFixture({
    history: {},
    refresh: {
      mode: "refreshed",
      networkRequests: 2,
      creditCount: 2,
      currentRefreshed: false,
      historyRefreshed: true,
    },
  });
  const legacyState = stateFixture({
    updatedAt: "2026-07-28T12:00:00.000Z",
    history: legacyHistory,
    watermarks: {
      lastAttemptedAt: "2026-07-28T12:00:00.000Z",
      lastSuccessfulAt: "2026-07-28T12:00:00.000Z",
      lastHistoryAttemptedAt: "2026-07-28T12:00:00.000Z",
      lastHistorySuccessfulAt: "2026-07-28T12:00:00.000Z",
    },
  });
  const latestRows = [
    {
      id: 11,
      status: "completed",
      created_at: "2026-07-31T11:56:00.000Z",
      details: {
        result: { historyAttempted: true },
        cmcProviderState: compactState,
        cmcHistoryDelta: deltaHistory,
      },
    },
    {
      id: 10,
      status: "completed",
      created_at: "2026-07-28T12:00:00.000Z",
      details: { cmcProviderState: legacyState },
    },
  ];
  const observationRows = [
    {
      metric_id: "btc.marketCap",
      observed_at: "2026-07-27T00:00:00.000Z",
      value: "malformed-value-must-be-skipped",
      source_key: "cmc",
      fetched_at: NOW,
    },
    {
      metric_id: "btc.marketCap",
      observed_at: "2026-07-30T00:00:00.000Z",
      value: 3_000_000,
      source: "cmc",
      source_key: "cmc",
      source_url: "https://coinmarketcap.com/api/documentation/pro-api-reference/cryptocurrency",
      quality_status: "database_last_known_good",
      fetched_at: NOW,
      last_checked_at: NOW,
      metadata: { sourceObservedAt: "2026-07-30T00:00:00.000Z" },
    },
  ];
  const requests = [];
  const fetchImpl = async (url) => {
    const text = String(url);
    requests.push(text);
    let body = [];
    if (text.includes("market_metric_observations")) body = observationRows;
    else if (!text.includes("created_at=gte.")) body = latestRows;
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const store = createCmcProviderStateStore({
    workspaceRoot: resolve("C:/workspace/cycle-map-compact-hydration"),
    environment: {
      SUPABASE_URL: "https://unit-test.supabase.co",
      SUPABASE_SECRET_KEY: "sb_secret_unit_test",
    },
    fetchImpl,
    now: () => new Date("2026-08-01T00:05:00.000Z"),
  });
  const loaded = await store.load();
  assert.deepEqual(
    loaded.history["btc.marketCap"].map((point) => point.date),
    ["2026-07-28", "2026-07-29", "2026-07-30"],
  );
  assert.equal(loaded.state.current.assets.BTC.id, 1);
  assert.ok(requests.some((url) => url.includes("limit=200")));
  assert.ok(requests.some((url) => url.includes("created_at=gte.2026-08-01")));
  assert.ok(requests.some((url) => decodeURIComponent(url).includes("source_key=eq.cmc")));
});

test("Supabase hydration restores the latest prior-month LKG while the ledger remains month-scoped", async () => {
  const priorMonthState = stateFixture();
  const requests = [];
  const fetchImpl = async (url) => {
    const text = String(url);
    requests.push(text);
    let body = [];
    if (text.includes("dashboard_snapshot_runs") && !text.includes("created_at=gte.")) {
      body = [{
        id: 9,
        status: "completed",
        created_at: "2026-07-31T11:59:00.000Z",
        details: { cmcProviderState: priorMonthState },
      }];
    }
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const store = createCmcProviderStateStore({
    workspaceRoot: resolve("C:/workspace/cycle-map-test-cross-month"),
    environment: {
      SUPABASE_URL: "https://unit-test.supabase.co",
      SUPABASE_SECRET_KEY: "sb_secret_unit_test",
    },
    fetchImpl,
    now: () => new Date("2026-08-01T00:05:00.000Z"),
  });
  const loaded = await store.load();
  assert.equal(loaded.state.current.assets.BTC.id, 1);
  assert.equal(loaded.ledger.dailyCreditsReserved, 0);
  assert.equal(loaded.ledger.monthlyCreditsReserved, 0);
  assert.equal(requests.length, 4);
  assert.ok(requests.some((url) => url.includes("created_at=gte.2026-08-01")));
  assert.ok(requests.some((url) => url.includes("status=in.%28completed%2Cfailed%29") || url.includes("status=in.(completed,failed)")));
});

test("Supabase origin validation rejects lookalike or credential-bearing destinations before fetch", () => {
  for (const url of [
    "https://unit-test.supabase.co.evil.example",
    "https://user:pass@unit-test.supabase.co",
    "http://unit-test.supabase.co",
    "https://localhost",
  ]) {
    assert.throws(() => createCmcProviderStateStore({
      workspaceRoot: resolve("C:/workspace/cycle-map"),
      environment: { SUPABASE_URL: url, SUPABASE_SECRET_KEY: "sb_secret_unit" },
      fetchImpl: async () => { throw new Error("unexpected"); },
    }), /cmc_supabase_origin_invalid/);
  }
  assert.throws(() => createCmcProviderStateStore({
    workspaceRoot: resolve("C:/workspace/cycle-map"),
    environment: {
      SUPABASE_URL: "https://unit-test.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "legacy-key-is-not-accepted",
    },
  }), /cmc_supabase_config_incomplete/);
});

test("refresh coordinator module is import-safe and does not execute main as a side effect", async () => {
  const module = await import("../scripts/refresh-cmc-provider-state.mjs");
  assert.equal(typeof module.main, "function");
  assert.equal(typeof module.refreshCmcProviderState, "function");
});

test("history request accounting remains bounded even for an initial 365-day hydration", () => {
  const state = stateFixture({
    history: {},
    watermarks: {
      lastAttemptedAt: "2026-07-31T11:00:00.000Z",
      lastHistoryAttemptedAt: new Date(Date.parse(NOW) - 21 * 60 * 60 * 1000).toISOString(),
    },
  });
  const budget = budgetForNow({
    budgets: { dailyCreditBudget: 100, monthlyCreditBudget: 1000 },
    ledger: {},
    now: NOW,
  });
  const plan = planCmcProviderRefresh({ state, budget, now: NOW });
  const historyRequests = plan.requests.filter((request) => request.kind.startsWith("history_"));
  assert.equal(historyRequests.length, 2);
  assert.ok(historyRequests.every((request) => request.reservedCredits >= 1));
  assert.ok(plan.reservedCredits <= budget.dailyCreditBudget);
  assert.equal(Math.round(CMC_HISTORY_MIN_INTERVAL_MS / DAY_MS), 1);
});
