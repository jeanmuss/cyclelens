import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { METRIC_CATALOG_BY_ID } from "../src/domain/metrics/metricCatalog.js";
import {
  DASHBOARD_LAYOUT_VERSION,
  DEFAULT_DASHBOARD_LAYOUT,
  moveDashboardWidget,
  parseDashboardLayout,
  readDashboardLayoutPreference,
  setDashboardWidgetVisibility,
  writeDashboardLayoutPreference,
} from "../src/features/dashboard/dashboardPreferences.js";
import {
  dashboardMetricMap,
  formatDashboardValue,
  metricSnapshot,
} from "../src/features/dashboard/dashboardModel.js";
import { DASHBOARD_WIDGET_DEFINITIONS } from "../src/features/dashboard/widgetDefinitions.js";
import { PREFERENCE_KEYS } from "../src/localPreferences.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(testDirectory, "..");

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
}

test("widget definitions declare immutable catalog dependencies and deterministic defaults", () => {
  assert.equal(new Set(DASHBOARD_WIDGET_DEFINITIONS.map((item) => item.id)).size, DASHBOARD_WIDGET_DEFINITIONS.length);
  assert.deepEqual(
    DASHBOARD_WIDGET_DEFINITIONS.map((item) => item.defaultPosition),
    DASHBOARD_WIDGET_DEFINITIONS.map((_, index) => index),
  );
  for (const definition of DASHBOARD_WIDGET_DEFINITIONS) {
    assert.ok(["standard", "wide"].includes(definition.size));
    assert.ok(definition.markets.length > 0);
    assert.ok(definition.metricIds.length > 0);
    assert.equal(definition.componentId, "metric-list");
    assert.ok(definition.metricIds.every((metricId) => METRIC_CATALOG_BY_ID[metricId]?.projections.includes("dashboard")));
    assert.ok(Object.isFrozen(definition));
  }
});

test("versioned device layouts persist visibility and ordering", () => {
  const storage = memoryStorage();
  const firstId = DEFAULT_DASHBOARD_LAYOUT.order[0];
  const secondId = DEFAULT_DASHBOARD_LAYOUT.order[1];
  const hidden = setDashboardWidgetVisibility(DEFAULT_DASHBOARD_LAYOUT, firstId, false);
  const moved = moveDashboardWidget(hidden, secondId, -1);

  assert.equal(moved.version, DASHBOARD_LAYOUT_VERSION);
  assert.equal(moved.order[0], secondId);
  assert.deepEqual(moved.hidden, [firstId]);
  assert.equal(writeDashboardLayoutPreference(moved, { storage }), true);
  assert.deepEqual(readDashboardLayoutPreference({ storage }), moved);
  assert.equal(JSON.parse(storage.values.get(PREFERENCE_KEYS.dashboardLayout)).version, DASHBOARD_LAYOUT_VERSION);
});

test("legacy layouts migrate and corrupt or unsupported data falls back safely", () => {
  const [firstId, secondId] = DEFAULT_DASHBOARD_LAYOUT.order;
  const migrated = parseDashboardLayout(JSON.stringify({
    version: 1,
    widgets: [
      { id: secondId, visible: true },
      { id: firstId, visible: false },
    ],
  }));
  assert.equal(migrated.version, DASHBOARD_LAYOUT_VERSION);
  assert.deepEqual(migrated.order.slice(0, 2), [secondId, firstId]);
  assert.deepEqual(migrated.hidden, [firstId]);

  for (const raw of ["not-json", "{}", JSON.stringify({ version: 99, order: [], hidden: [] })]) {
    const storage = memoryStorage({ [PREFERENCE_KEYS.dashboardLayout]: raw });
    assert.equal(readDashboardLayoutPreference({ storage }), DEFAULT_DASHBOARD_LAYOUT);
  }
});

test("dashboard model selects the latest observation without confusing transform and observation time", () => {
  const metric = {
    metricId: "macro.JGB10Y.value",
    defaultDisplay: { format: "percent", precision: 3 },
    observations: [
      { observedAt: "2026-07-17T00:00:00Z", value: 2.1 },
      { observedAt: "2026-07-18T00:00:00Z", value: 2.25 },
    ],
  };
  const projection = { generatedAt: "2026-07-19T00:00:00Z", metrics: [metric] };
  const snapshot = metricSnapshot(dashboardMetricMap(projection).get(metric.metricId));
  assert.equal(snapshot.latest.observedAt, "2026-07-18T00:00:00Z");
  assert.equal(snapshot.change, 0.1499999999999999);
  assert.equal(formatDashboardValue(metric, snapshot.latestValue, "en"), "2.250%");
});

test("homepage consumes only the dashboard projection and the registry resolves a real renderer", async () => {
  const [pageSource, registrySource] = await Promise.all([
    readFile(resolve(appRoot, "src/pages/DashboardPage.jsx"), "utf8"),
    readFile(resolve(appRoot, "src/features/dashboard/widgetRegistry.jsx"), "utf8"),
  ]);
  assert.match(pageSource, /useLiveData\(DASHBOARD_LIVE_DATA\)/);
  assert.doesNotMatch(pageSource, /fetch\(|CMC|DefiLlama|SoSoValue|Supabase/i);
  assert.match(pageSource, /!error && loading && !projection/);
  assert.match(pageSource, /error \? copy\.unavailable : copy\.loading/);
  assert.match(registrySource, /component:\s*componentById\[definition\.componentId\]/);
});
