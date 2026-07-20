import assert from "node:assert/strict";
import test from "node:test";

import { DASHBOARD_WIDGET_DEFINITIONS } from "../src/features/dashboard/widgetDefinitions.js";
import {
  createTelegramMorningBrief,
  escapeTelegramHtml,
  renderTelegramMorningBriefHtml,
  shanghaiDateKey,
  TELEGRAM_MORNING_BRIEF_METRIC_IDS,
  TELEGRAM_TEXT_LIMIT,
  telegramPlainTextLength,
  validateTelegramMorningBrief,
} from "../scripts/telegram-morning-brief-contract.mjs";
import {
  sendTelegramMorningBrief,
  TelegramDeliveryError,
} from "../scripts/send-telegram-morning-brief.mjs";

function response(status, payload) {
  return { status, ok: status >= 200 && status < 300, async json() { return payload; } };
}

function projection() {
  return {
    schemaVersion: 1,
    catalogVersion: 2,
    projectionId: "dashboard",
    generatedAt: "2026-07-20T22:30:00.000Z",
    metrics: [{
      metricId: "crypto.totalMarketCap",
      title: { zh: "ignored", en: "ignored" },
      unit: "USD",
      cadence: "daily",
      defaultDisplay: { format: "compact_currency", precision: 2 },
      sources: [{ sourcePolicyId: "coinmarketcap", label: "untrusted <source>" }],
      observations: [
        { observedAt: "2026-07-13T00:00:00.000Z", value: 100, qualityStatus: "available", sourcePolicyId: "coinmarketcap" },
        { observedAt: "2026-07-19T00:00:00.000Z", value: 110, qualityStatus: "available", sourcePolicyId: "coinmarketcap" },
        { observedAt: "2026-07-20T00:00:00.000Z", value: 120, qualityStatus: "available", sourcePolicyId: "coinmarketcap" },
      ],
    }],
  };
}

test("the versioned report freezes all 25 current homepage metrics in display order", () => {
  assert.deepEqual(
    TELEGRAM_MORNING_BRIEF_METRIC_IDS,
    DASHBOARD_WIDGET_DEFINITIONS.flatMap((item) => item.metricIds),
  );
  assert.equal(TELEGRAM_MORNING_BRIEF_METRIC_IDS.length, 25);
  assert.equal(new Set(TELEGRAM_MORNING_BRIEF_METRIC_IDS).size, 25);
});

test("Shanghai dates form deterministic cross-midnight delivery keys", () => {
  assert.equal(shanghaiDateKey("2026-07-19T15:59:59.000Z"), "2026-07-19");
  assert.equal(shanghaiDateKey("2026-07-19T16:00:00.000Z"), "2026-07-20");
  const report = createTelegramMorningBrief(projection(), "2026-07-20T23:00:00.000Z");
  assert.equal(report.shanghaiDate, "2026-07-21");
  assert.equal(report.deliveryKey, "telegram-morning-brief-v1-2026-07-21");
});

test("missing homepage metrics stay N/A while retaining reviewed source provenance", () => {
  const report = createTelegramMorningBrief(projection(), "2026-07-20T23:00:00.000Z");
  assert.deepEqual(validateTelegramMorningBrief(report), []);
  assert.deepEqual(report.summary, { total: 25, available: 1, missing: 24 });
  const qqq = report.items.find((item) => item.metricId === "equity.us.qqq.price");
  assert.equal(qqq.value, "N/A");
  assert.equal(qqq.dayChange, "N/A");
  assert.equal(qqq.weekChange, "N/A");
  assert.equal(qqq.observedAtLabel, "N/A");
  assert.equal(qqq.freshness.label, "N/A");
  assert.equal(qqq.qualityStatus, "missing");
  assert.deepEqual(qqq.sources, ["AKShare aggregation adapters"]);
  const available = report.items.find((item) => item.metricId === "crypto.totalMarketCap");
  assert.notEqual(available.value, "N/A");
  assert.notEqual(available.dayChange, "N/A");
  assert.notEqual(available.weekChange, "N/A");
});

test("the compact Telegram HTML is escaped and remains below the provider limit", () => {
  const report = createTelegramMorningBrief(projection(), "2026-07-20T23:00:00.000Z");
  const html = renderTelegramMorningBriefHtml(report);
  assert.equal(escapeTelegramHtml('<unsafe & "quoted">'), "&lt;unsafe &amp; &quot;quoted&quot;&gt;");
  assert.match(html, /CycleLens 每日早报/);
  assert.match(html, /N\/A/);
  assert.ok(telegramPlainTextLength(html) <= TELEGRAM_TEXT_LIMIT);
  assert.doesNotMatch(html, /untrusted <source>/);
});

test("the sender retries one explicit rate limit without returning identifiers", async () => {
  const report = createTelegramMorningBrief(projection(), "2026-07-20T23:00:00.000Z");
  report.telegramHtml = renderTelegramMorningBriefHtml(report);
  const calls = [];
  const delays = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1
      ? response(429, { ok: false, parameters: { retry_after: 2 } })
      : response(200, { ok: true, result: { message_id: 123, chat: { id: -100123 } } });
  };
  const receipt = await sendTelegramMorningBrief({
    report,
    token: "test-token-without-credentials-123456",
    chatId: "-1001234567890",
    fetchImpl,
    delay: async (milliseconds) => delays.push(milliseconds),
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(delays, [2000]);
  assert.equal(receipt.outcome, "accepted");
  assert.equal("messageId" in receipt, false);
  assert.equal("chatId" in receipt, false);
});

test("ambiguous Telegram failures are not automatically retried", async () => {
  const report = createTelegramMorningBrief(projection(), "2026-07-20T23:00:00.000Z");
  report.telegramHtml = renderTelegramMorningBriefHtml(report);
  let calls = 0;
  await assert.rejects(
    sendTelegramMorningBrief({
      report,
      token: "test-token-without-credentials-123456",
      chatId: "@cyclelens_test",
      fetchImpl: async () => {
        calls += 1;
        return response(503, { ok: false });
      },
      delay: async () => {},
    }),
    (error) => error instanceof TelegramDeliveryError && error.code === "outcome_unknown",
  );
  assert.equal(calls, 1);
});
