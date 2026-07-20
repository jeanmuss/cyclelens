import { METRIC_CATALOG_BY_ID } from "../src/domain/metrics/metricCatalog.js";
import { SOURCE_POLICY_BY_ID } from "../src/domain/metrics/sourcePolicy.js";
import {
  formatDashboardChange,
  formatDashboardValue,
  metricSnapshot,
} from "../src/features/dashboard/dashboardModel.js";

export const TELEGRAM_MORNING_BRIEF_SCHEMA_VERSION = 1;
export const TELEGRAM_MORNING_BRIEF_CONTRACT_VERSION = 1;
export const TELEGRAM_MORNING_BRIEF_TIME_ZONE = "Asia/Shanghai";
export const TELEGRAM_TEXT_LIMIT = 4096;

const DAY_MS = 24 * 60 * 60 * 1000;
const freshnessDaysByCadence = Object.freeze({ daily: 4, weekly: 11, disclosure: 120 });

function group(id, title, metricIds) {
  return Object.freeze({ id, title, metricIds: Object.freeze(metricIds) });
}

// This is deliberately explicit. A homepage registry change must not silently alter
// a production notification contract without a contract-version review.
export const TELEGRAM_MORNING_BRIEF_GROUPS = Object.freeze([
  group("us-equity-overview", "美股大盘", [
    "equity.us.qqq.price",
    "equity.us.spy.price",
    "equity.us.dia.price",
    "equity.us.sox.value",
    "commodity.gold.proxy",
  ]),
  group("macro-liquidity-overview", "宏观流动性", [
    "macro.riskPosture.score",
    "macro.US10Y.value",
    "macro.US10Y.realYield",
    "macro.DXY.value",
    "macro.VIX.value",
    "macro.HYOAS.value",
    "macro.netLiquidity.usd",
  ]),
  group("market-breadth", "加密市场规模", [
    "crypto.totalMarketCap",
    "btc.marketCap",
  ]),
  group("stablecoin-liquidity", "稳定币流动性", [
    "stablecoin.major.marketCap",
    "stablecoin.usdt.marketCap",
    "stablecoin.usdc.marketCap",
  ]),
  group("etf-flows", "现货 ETF 资金流", [
    "crypto.etf.BTC.net_flow_usd",
    "crypto.etf.ETH.net_flow_usd",
    "crypto.etf.SOL.net_flow_usd",
  ]),
  group("strategy-treasury", "Strategy 财库", [
    "treasury.mstr.btc_holdings",
    "treasury.mstr.btc_average_cost_usd",
  ]),
  group("bitmine-treasury", "BitMine 财库", [
    "treasury.bmnr.eth_holdings",
    "treasury.bmnr.eth_average_cost_usd",
  ]),
  group("japan-rates", "日本长期利率", ["macro.JGB10Y.value"]),
]);

export const TELEGRAM_MORNING_BRIEF_METRIC_IDS = Object.freeze(
  TELEGRAM_MORNING_BRIEF_GROUPS.flatMap((item) => item.metricIds),
);

function dateParts(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("A valid report timestamp is required");
  return Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: TELEGRAM_MORNING_BRIEF_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).filter((item) => item.type !== "literal").map((item) => [item.type, item.value]));
}

export function shanghaiDateKey(value) {
  const { year, month, day } = dateParts(value);
  return `${year}-${month}-${day}`;
}

export function formatShanghaiObservation(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return "N/A";
  const { year, month, day, hour, minute } = dateParts(value);
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

function compactText(value, maxLength = 48) {
  const normalized = String(value || "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  const characters = [...normalized];
  return characters.length <= maxLength ? normalized : `${characters.slice(0, maxLength - 1).join("")}…`;
}

function sourceLabels(metric, catalogEntry, latest) {
  const latestPolicyId = latest?.sourcePolicyId;
  const projectedPolicyIds = (metric?.sources || []).map((item) => item.sourcePolicyId).filter(Boolean);
  const policyIds = latestPolicyId
    ? [latestPolicyId]
    : projectedPolicyIds.length
      ? projectedPolicyIds
      : catalogEntry.sourcePolicyIds;
  return [...new Set(policyIds.map((id) => SOURCE_POLICY_BY_ID[id]?.label || id))]
    .map((label) => compactText(label))
    .filter(Boolean);
}

function freshnessFor(catalogEntry, latest, now) {
  const observedAt = Date.parse(latest?.observedAt);
  if (!Number.isFinite(observedAt)) return { status: "missing", label: "N/A", ageDays: null };
  const ageMs = now.getTime() - observedAt;
  if (ageMs < -5 * 60 * 1000) return { status: "future", label: "时间异常", ageDays: null };
  const ageDays = Math.max(0, Math.floor(ageMs / DAY_MS));
  const limitDays = freshnessDaysByCadence[catalogEntry.cadence] ?? 4;
  return ageMs <= limitDays * DAY_MS
    ? { status: "fresh", label: `新鲜（${ageDays}天）`, ageDays }
    : { status: "stale", label: `陈旧（${ageDays}天）`, ageDays };
}

function reportItem(metricId, projectionMetric, now) {
  const catalogEntry = METRIC_CATALOG_BY_ID[metricId];
  if (!catalogEntry) throw new Error(`Unknown morning brief metric: ${metricId}`);
  const snapshot = metricSnapshot(projectionMetric);
  const latest = snapshot.latest;
  const missing = snapshot.latestValue === null;
  return {
    metricId,
    title: catalogEntry.title.zh,
    value: formatDashboardValue(catalogEntry, snapshot.latestValue, "zh"),
    dayChange: formatDashboardChange(catalogEntry, snapshot.dayChange, "zh"),
    weekChange: formatDashboardChange(catalogEntry, snapshot.weekChange, "zh"),
    observedAt: latest?.observedAt || null,
    observedAtLabel: formatShanghaiObservation(latest?.observedAt),
    freshness: freshnessFor(catalogEntry, latest, now),
    qualityStatus: compactText(missing ? "missing" : latest?.qualityStatus || "available", 36),
    sources: sourceLabels(projectionMetric, catalogEntry, latest),
    missing,
  };
}

export function createTelegramMorningBrief(projection, nowValue = new Date()) {
  if (projection?.projectionId !== "dashboard" || !Array.isArray(projection?.metrics)) {
    throw new Error("A valid dashboard projection is required");
  }
  const now = nowValue instanceof Date ? nowValue : new Date(nowValue);
  if (!Number.isFinite(now.getTime())) throw new Error("A valid report timestamp is required");
  const projectionById = new Map(projection.metrics.map((metric) => [metric.metricId, metric]));
  const items = TELEGRAM_MORNING_BRIEF_METRIC_IDS.map((metricId) => reportItem(
    metricId,
    projectionById.get(metricId),
    now,
  ));
  const shanghaiDate = shanghaiDateKey(now);
  return {
    schemaVersion: TELEGRAM_MORNING_BRIEF_SCHEMA_VERSION,
    contractVersion: TELEGRAM_MORNING_BRIEF_CONTRACT_VERSION,
    deliveryKey: `telegram-morning-brief-v${TELEGRAM_MORNING_BRIEF_CONTRACT_VERSION}-${shanghaiDate}`,
    shanghaiDate,
    generatedAt: now.toISOString(),
    projectionGeneratedAt: projection.generatedAt || null,
    groups: TELEGRAM_MORNING_BRIEF_GROUPS.map((item) => ({
      id: item.id,
      title: item.title,
      metricIds: [...item.metricIds],
    })),
    items,
    summary: {
      total: items.length,
      available: items.filter((item) => !item.missing).length,
      missing: items.filter((item) => item.missing).length,
    },
  };
}

export function validateTelegramMorningBrief(report) {
  const errors = [];
  if (report?.schemaVersion !== TELEGRAM_MORNING_BRIEF_SCHEMA_VERSION) errors.push("invalid schemaVersion");
  if (report?.contractVersion !== TELEGRAM_MORNING_BRIEF_CONTRACT_VERSION) errors.push("invalid contractVersion");
  if (!/^telegram-morning-brief-v\d+-\d{4}-\d{2}-\d{2}$/.test(report?.deliveryKey || "")) errors.push("invalid deliveryKey");
  if (!Array.isArray(report?.items)) errors.push("items must be an array");
  const ids = (report?.items || []).map((item) => item.metricId);
  if (JSON.stringify(ids) !== JSON.stringify(TELEGRAM_MORNING_BRIEF_METRIC_IDS)) errors.push("metric contract mismatch");
  for (const item of report?.items || []) {
    if (!item.title || !item.value || !item.dayChange || !item.weekChange) errors.push(`${item.metricId}: incomplete display fields`);
    if (!item.observedAtLabel || !item.freshness?.label || !item.qualityStatus || !item.sources?.length) {
      errors.push(`${item.metricId}: incomplete provenance fields`);
    }
    if (item.missing && [item.value, item.dayChange, item.weekChange, item.observedAtLabel, item.freshness.label].some((value) => value !== "N/A")) {
      errors.push(`${item.metricId}: missing values must remain N/A`);
    }
  }
  return errors;
}

export function escapeTelegramHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function telegramPlainTextLength(html) {
  const plain = String(html)
    .replace(/<[^>]*>/g, "")
    .replace(/&(amp|lt|gt|quot);/g, "x");
  return [...plain].length;
}

export function renderTelegramMorningBriefHtml(report) {
  const errors = validateTelegramMorningBrief(report);
  if (errors.length) throw new Error(`Invalid morning brief: ${errors.join("; ")}`);
  const itemById = new Map(report.items.map((item) => [item.metricId, item]));
  const lines = [
    "<b>CycleLens 每日早报</b>",
    `上海日期 ${escapeTelegramHtml(report.shanghaiDate)} · 合约 v${report.contractVersion}`,
    "<i>数值取最近合格观测；缺失项及不可计算的日/周变化显示 N/A。</i>",
  ];
  for (const groupEntry of report.groups) {
    lines.push("", `<b>${escapeTelegramHtml(groupEntry.title)}</b>`);
    for (const metricId of groupEntry.metricIds) {
      const item = itemById.get(metricId);
      const source = item.sources.join(" / ");
      lines.push(
        `• <b>${escapeTelegramHtml(item.title)}</b> ${escapeTelegramHtml(item.value)}｜日 ${escapeTelegramHtml(item.dayChange)}｜周 ${escapeTelegramHtml(item.weekChange)}`,
        `  观测 ${escapeTelegramHtml(item.observedAtLabel)}｜${escapeTelegramHtml(item.freshness.label)}｜质量 ${escapeTelegramHtml(item.qualityStatus)}｜源 ${escapeTelegramHtml(source)}`,
      );
    }
  }
  lines.push("", `共 ${report.summary.total} 项 · 可用 ${report.summary.available} · N/A ${report.summary.missing}`);
  const html = lines.join("\n");
  const plainTextLength = telegramPlainTextLength(html);
  if (plainTextLength > TELEGRAM_TEXT_LIMIT) {
    throw new Error(`Telegram morning brief exceeds ${TELEGRAM_TEXT_LIMIT} characters`);
  }
  return html;
}
