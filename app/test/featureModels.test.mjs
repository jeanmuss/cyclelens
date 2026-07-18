import assert from "node:assert/strict";
import test from "node:test";

import {
  dateKeyFromUtc,
  dateKeyInTimeZone,
  utcDateFromKey,
} from "../src/shared/dates/calendar.js";
import {
  eventsByDate,
  monthGrid,
  pressureSignal,
  shiftMonth,
} from "../src/features/macro/macroCalendarModel.js";
import {
  metricLinePath,
  metricPercentile,
  transformMetricPoints,
} from "../src/features/us-equity/equityModel.js";
import {
  countdownLabel,
  marketStatus,
  minutesFromTime,
  timeFromMinutes,
} from "../src/features/market-clock/marketClockModel.js";
import {
  chipHeatClass,
  chipSparkGeometry,
  chipTreemapTiles,
} from "../src/domain/supplyChain.js";
import {
  robotCategoryRows,
  robotTopMovers,
} from "../src/features/robot-chain/robotChainModel.js";
import {
  adminValidationErrors,
  normalizeAdminEventForList,
} from "../src/features/admin-macro-events/adminMacroModel.js";

test("shared calendar helpers preserve UTC keys and language calendar dates", () => {
  assert.equal(dateKeyFromUtc(utcDateFromKey("2026-07-18")), "2026-07-18");
  assert.equal(dateKeyInTimeZone("2026-01-02T00:30:00Z", "America/New_York"), "2026-01-01");
  assert.equal(dateKeyInTimeZone("2026-01-02T00:30:00Z", "Asia/Shanghai"), "2026-01-02");
});

test("macro calendar model computes month grids, shifted months, and localized event dates", () => {
  const grid = monthGrid("2024-02", "zh");
  assert.equal(grid.length, 35);
  assert.equal(grid[0].dateKey, "2024-01-28");
  assert.equal(grid.at(-1).dateKey, "2024-03-02");
  assert.equal(grid.filter((day) => day.inMonth).length, 29);
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-12", 1), "2027-01");

  const event = { date: "2026-01-02", releaseTimeUtc: "2026-01-02T00:30:00Z" };
  assert.equal(eventsByDate([event], "en").get("2026-01-01")?.[0], event);
  assert.equal(eventsByDate([event], "zh").get("2026-01-02")?.[0], event);
  assert.equal(pressureSignal({ changeBp: 3 }), 1);
  assert.equal(pressureSignal({ changeBp: -3 }), -1);
  assert.equal(pressureSignal({ changeBp: 3, carriedForward: true }), 0);
});

test("equity chart transforms and path gaps are deterministic", () => {
  const points = [
    { ms: 0, raw: 100 },
    { ms: 86400000, raw: 110 },
    { ms: 6 * 86400000, raw: 90 },
  ];
  assert.deepEqual(transformMetricPoints(points, "indexed").map((point) => Math.round(point.value)), [100, 110, 90]);
  assert.deepEqual(transformMetricPoints(points, "changePct").map((point) => Math.round(point.value)), [0, 10, -10]);
  assert.equal(metricPercentile([4, 1, 3, 2], 0.5), 2.5);
  assert.equal(metricLinePath([
    { ms: 0, x: 1, y: 2 },
    { ms: 86400000, x: 3, y: 4 },
    { ms: 6 * 86400000, x: 5, y: 6 },
  ], { cadence: "daily" }), "M 1.00 2.00 L 3.00 4.00 M 5.00 6.00");
});

test("market clock model wraps time and handles always-open markets", () => {
  assert.equal(minutesFromTime("09:30"), 570);
  assert.equal(timeFromMinutes(-1), "23:59");
  assert.equal(timeFromMinutes(1440), "00:00");
  assert.equal(countdownLabel(1501, "zh"), "1\u5929 1\u5c0f\u65f6 1\u5206");
  assert.equal(countdownLabel(61, "en"), "1h 1m");

  const copy = { status: { trading: "Trading" }, alwaysOpen: "24/7" };
  assert.deepEqual(marketStatus({ stateModel: "always_open" }, new Date("2026-07-18T00:00:00Z"), "en", copy), {
    key: "trading",
    label: "Trading",
    active: true,
    sortRank: 0,
    localTime: "24/7",
    nextText: "24/7",
    nextTransitionAt: null,
    reason: null,
  });
});

test("supply-chain domain helpers keep heat and treemap geometry stable", () => {
  assert.equal(chipHeatClass(8), "chip-heat-up-4");
  assert.equal(chipHeatClass(-8), "chip-heat-down-4");
  assert.equal(chipHeatClass(Number.NaN), "chip-heat-na");
  const spark = chipSparkGeometry([10, 20, 15]);
  assert.equal(spark.points, "0.0,25.0 47.0,3.0 94.0,14.0");
  assert.deepEqual(spark.end, { x: 94, y: 14 });

  const tiles = chipTreemapTiles([
    { symbol: "AAA", returns: { "1m": 8 } },
    { symbol: "BBB", returns: { "1m": -4 } },
    { symbol: "CCC", returns: { "1m": 1 } },
  ], "1m");
  assert.deepEqual(tiles.map((tile) => tile.asset.symbol).sort(), ["AAA", "BBB", "CCC"]);
  const totalArea = tiles.reduce((sum, tile) => sum + tile.rect.width * tile.rect.height, 0);
  assert.ok(Math.abs(totalArea - 10000) < 0.000001);
});

test("robot-chain adapters deduplicate and rank valid movers", () => {
  const dataset = {
    assets: {
      AAA: { symbol: "AAA", returns: { "1m": 3 } },
      BBB: { symbol: "BBB", returns: { "1m": -1 } },
    },
    categories: [
      { id: "hardware", tickers: ["AAA", "BBB"] },
      { id: "software", tickers: ["AAA", "MISSING"] },
    ],
  };
  const rows = robotCategoryRows(dataset);
  assert.equal(rows.length, 2);
  assert.deepEqual(robotTopMovers(rows, "1m").map((asset) => asset.symbol), ["AAA", "BBB"]);
});

test("admin macro adapter validates required fields and normalizes numeric payloads", () => {
  const copy = { validation: {
    date: "date",
    seriesId: "series",
    label: "label",
    source: "source",
    releaseTimeUtc: "release",
  } };
  assert.deepEqual(adminValidationErrors({
    date: "bad",
    seriesId: "x",
    label: "",
    source: "",
    releaseTimeUtc: "bad",
  }, copy), ["date", "series", "label", "source", "release"]);
  assert.deepEqual(normalizeAdminEventForList({
    labelZh: "\u4e2d\u6587",
    labelEn: "English",
    actual: "1.5",
    previous: "",
    forecast: null,
  }), {
    labelZh: "\u4e2d\u6587",
    labelEn: "English",
    label: "\u4e2d\u6587 / English",
    actual: 1.5,
    previous: null,
    forecast: null,
  });
});
