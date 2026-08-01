import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import {
  CMC_HISTORY_METRIC_IDS,
  CMC_PROVIDER_ASSETS,
  budgetForNow,
  planCmcProviderRefresh,
} from "../scripts/cmc-provider-state-contract.mjs";
import { createCmcProviderStateStore } from "../scripts/cmc-provider-state-store.mjs";

const NOW = "2026-07-31T12:00:00.000Z";
const DAY_MS = 86_400_000;

function stateFixture({ historyRefreshed = false } = {}) {
  const observedAt = "2026-07-31T11:55:00.000Z";
  return {
    version: 1,
    provider: "coinmarketcap",
    dataUseScope: "owner_private",
    updatedAt: "2026-07-31T11:56:00.000Z",
    current: {
      fetchedAt: "2026-07-31T11:56:00.000Z",
      global: {
        totalMarketCapUsd: 3_000_000,
        totalMarketCapYesterdayUsd: 2_900_000,
        totalMarketCapChangePct24h: 3.45,
        observedAt,
      },
      assets: Object.fromEntries(Object.entries(CMC_PROVIDER_ASSETS).map(([symbol, definition]) => [
        symbol,
        {
          ...definition,
          priceUsd: symbol === "USDT" ? 0.9995 : 100,
          marketCapUsd: 1_000 + definition.id,
          percentChange24h: -1.5,
          observedAt,
        },
      ])),
    },
    history: {},
    watermarks: {
      lastAttemptedAt: "2026-07-31T11:56:00.000Z",
      lastSuccessfulAt: "2026-07-31T11:56:00.000Z",
      lastHistoryAttemptedAt: "2026-07-30T14:00:00.000Z",
      lastHistorySuccessfulAt: "2026-07-30T14:00:00.000Z",
    },
    budget: {
      utcDay: "2026-07-31",
      utcMonth: "2026-07",
      dailyCreditBudget: 100,
      monthlyCreditBudget: 1_000,
      dailyCreditsReserved: 0,
      monthlyCreditsReserved: 0,
    },
    refresh: {
      mode: "refreshed",
      networkRequests: historyRefreshed ? 2 : 0,
      creditCount: historyRefreshed ? 2 : 0,
      currentRefreshed: false,
      historyRefreshed,
    },
  };
}

function dates(count = 365) {
  const end = Date.parse("2026-07-30T00:00:00.000Z");
  return Array.from({ length: count }, (_, index) => (
    new Date(end - (count - index - 1) * DAY_MS).toISOString().slice(0, 10)
  ));
}

function historyPoints() {
  return dates().map((date, index) => ({
    date,
    value: 2_000_000 + index,
    observedAt: `${date}T00:00:00.000Z`,
    source: "cmc",
    sourceUrl: "https://coinmarketcap.com/api/documentation/pro-api-reference/global-metrics",
    sourceKey: "cmc",
    fetchedAt: NOW,
    lastCheckedAt: NOW,
    qualityStatus: "provider_reported",
  }));
}

function requiredHistory() {
  return Object.fromEntries(CMC_HISTORY_METRIC_IDS.map((metricId, metricIndex) => [
    metricId,
    historyPoints().map((point) => ({ ...point, value: point.value + metricIndex })),
  ]));
}

function response(body) {
  return new Response(JSON.stringify(body), { status: 200 });
}

function storeWith(fetchImpl, name) {
  return createCmcProviderStateStore({
    workspaceRoot: resolve(`C:/workspace/${name}`),
    environment: {
      SUPABASE_URL: "https://unit-test.supabase.co",
      SUPABASE_SECRET_KEY: "sb_secret_unit_test",
    },
    fetchImpl,
    now: () => new Date(NOW),
  });
}

test("sufficient CMC observation coverage skips the history-delta fallback query", async () => {
  const requests = [];
  const observations = Object.entries(requiredHistory()).flatMap(([metricId, points]) => (
    points.map((point) => ({
      metric_id: metricId,
      observed_at: point.observedAt,
      value: point.value,
      source: "cmc",
      source_url: point.sourceUrl,
      source_key: "cmc",
      quality_status: "database_last_known_good",
      fetched_at: point.fetchedAt,
      last_checked_at: point.lastCheckedAt,
      metadata: { sourceObservedAt: point.observedAt },
    }))
  ));
  const fetchImpl = async (url) => {
    const parsed = new URL(String(url));
    requests.push(parsed);
    const select = parsed.searchParams.get("select") || "";
    if (parsed.pathname.endsWith("/market_metric_observations")) {
      const offset = Number(parsed.searchParams.get("offset") || 0);
      const limit = Number(parsed.searchParams.get("limit") || observations.length);
      return response(observations.slice(offset, offset + limit));
    }
    if (select === "id,status,created_at,details") {
      return response([{
        id: 1,
        status: "completed",
        created_at: "2026-07-31T11:56:00.000Z",
        details: { cmcProviderState: stateFixture() },
      }]);
    }
    return response([]);
  };

  const loaded = await storeWith(fetchImpl, "cmc-history-fallback-skip").load();
  assert.equal(loaded.history["crypto.totalMarketCap"].length, 365);
  assert.equal(
    requests.filter((url) => url.searchParams.has("details->result->>historyAttempted")).length,
    0,
  );
});

test("bounded fallback restores an initial delta evicted by 200 current rows and yields overlap planning", async () => {
  const requests = [];
  const compactCurrentState = stateFixture();
  const latestRows = Array.from({ length: 200 }, (_, index) => ({
    id: index + 100,
    status: "completed",
    created_at: new Date(Date.parse(NOW) - index * 60_000).toISOString(),
    details: { cmcProviderState: compactCurrentState },
  }));
  const deltaState = stateFixture({ historyRefreshed: true });
  const fetchImpl = async (url) => {
    const parsed = new URL(String(url));
    requests.push(parsed);
    const select = parsed.searchParams.get("select") || "";
    if (parsed.pathname.endsWith("/market_metric_observations")) return response([]);
    if (select === "id,status,created_at,details") return response(latestRows);
    if (select.includes("cmc_history_delta:details->cmcHistoryDelta")) {
      return response([{
        id: 1,
        status: "completed",
        created_at: "2026-07-01T00:00:00.000Z",
        cmc_provider_state: deltaState,
        cmc_history_delta: requiredHistory(),
        history_attempted: "true",
      }]);
    }
    return response([]);
  };

  const loaded = await storeWith(fetchImpl, "cmc-history-fallback-restore").load();
  assert.equal(loaded.history["crypto.totalMarketCap"].length, 365);
  const plan = planCmcProviderRefresh({
    state: loaded.state,
    budget: budgetForNow({
      budgets: { dailyCreditBudget: 100, monthlyCreditBudget: 1_000 },
      ledger: loaded.ledger,
      now: NOW,
    }),
    now: NOW,
  });
  assert.equal(plan.historyWindow.mode, "overlap");
  assert.match(plan.historyWindow.timeStart, /^2026-07-16/);

  const fallback = requests.find((url) => (
    url.searchParams.has("details->result->>historyAttempted")
  ));
  assert.ok(fallback);
  assert.equal(fallback.searchParams.get("status"), "eq.completed");
  assert.equal(fallback.searchParams.get("details->result->>historyAttempted"), "eq.true");
  assert.equal(fallback.searchParams.get("details->cmcHistoryDelta"), "not.is.null");
  assert.equal(fallback.searchParams.get("limit"), "200");
  assert.match(fallback.searchParams.get("select"), /cmc_history_delta:details->cmcHistoryDelta/);
  assert.doesNotMatch(fallback.searchParams.get("select"), /(?:^|,)details(?:,|$)/);
});
