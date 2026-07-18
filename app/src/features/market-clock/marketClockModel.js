import { readShowCryptoPreference } from "../../localPreferences.js";
import { assetSessionStatus } from "../../marketClockStatus.js";

export const MARKET_CLOCK_MINUTES_PER_DAY = 24 * 60;
export const MARKET_CLOCK_DISPLAY_TIME_ZONES = {
  zh: "Asia/Shanghai",
  en: "America/New_York",
};

export function getInitialShowCrypto() {
  return readShowCryptoPreference();
}

export function minutesFromTime(value) {
  const [hour, minute] = String(value || "00:00").split(":").map(Number);
  return (Number(hour) || 0) * 60 + (Number(minute) || 0);
}

export function timeFromMinutes(value) {
  const minutes = ((Math.round(Number(value) || 0) % MARKET_CLOCK_MINUTES_PER_DAY) + MARKET_CLOCK_MINUTES_PER_DAY) % MARKET_CLOCK_MINUTES_PER_DAY;
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function localClockLabel(timeZone, language, now) {
  const locale = language === "en" ? "en-US" : "zh-CN";
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
}

export function marketDisplayTimeZone(language) {
  return language === "en" ? MARKET_CLOCK_DISPLAY_TIME_ZONES.en : MARKET_CLOCK_DISPLAY_TIME_ZONES.zh;
}

export function timeZoneOffsetMinutes(timeZone, date) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date).map((part) => [part.type, part.value]),
  );
  const localAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );
  return Math.round((localAsUtc - date.getTime()) / 60000);
}

export function displayMarketTime(value, marketTimeZone, language, now) {
  if (!/^\d{2}:\d{2}$/.test(String(value || ""))) return "N/A";
  const displayZone = marketDisplayTimeZone(language);
  const shifted = minutesFromTime(value)
    + timeZoneOffsetMinutes(displayZone, now)
    - timeZoneOffsetMinutes(marketTimeZone, now);
  return timeFromMinutes(shifted);
}

export function displayMarketRange(start, end, marketTimeZone, language, now) {
  return `${displayMarketTime(start, marketTimeZone, language, now)}-${displayMarketTime(end, marketTimeZone, language, now)}`;
}

export function countdownLabel(totalMinutes, language) {
  if (!Number.isFinite(totalMinutes)) return "N/A";
  const minutes = Math.max(0, Math.round(totalMinutes));
  const days = Math.floor(minutes / MARKET_CLOCK_MINUTES_PER_DAY);
  const hours = Math.floor((minutes % MARKET_CLOCK_MINUTES_PER_DAY) / 60);
  const mins = minutes % 60;
  if (language === "en") {
    return days ? `${days}d ${hours}h ${mins}m` : `${hours}h ${mins}m`;
  }
  return days ? `${days}天 ${hours}小时 ${mins}分` : `${hours}小时 ${mins}分`;
}

export function marketStatusCopy(key, copy) {
  const aliases = {
    "opening-auction": "openingAuction",
    "closing-auction": "closingAuction",
    "fixed-price-gap": "fixedPriceGap",
    "fixed-price": "fixedPrice",
  };
  return copy.status[aliases[key] || key] || copy.status.closed;
}

export function countdownToIso(value, now, language) {
  const target = Date.parse(value);
  if (!Number.isFinite(target)) return "N/A";
  return countdownLabel((target - now.getTime()) / 60000, language);
}

export function marketStatus(market, now, language, copy) {
  if (market.stateModel === "always_open") {
    return {
      key: "trading",
      label: copy.status.trading,
      active: true,
      sortRank: 0,
      localTime: copy.alwaysOpen,
      nextText: copy.alwaysOpen,
      nextTransitionAt: null,
      reason: null,
    };
  }

  const nowMs = now.getTime();
  const entry = (market.statusTimeline || []).find((item) => Date.parse(item.startAt) <= nowMs && nowMs < Date.parse(item.endAt));
  if (!entry) {
    return {
      key: "closed",
      label: copy.status.closed,
      active: false,
      sortRank: 4,
      localTime: localClockLabel(market.timezone, language, now),
      nextText: "N/A",
      nextTransitionAt: null,
      reason: language === "en" ? "Official calendar coverage unavailable" : "\u5b98\u65b9\u4ea4\u6613\u65e5\u5386\u8986\u76d6\u8303\u56f4\u5916",
    };
  }

  const nextTransitionAt = entry.nextTransitionAt || entry.endAt;
  return {
    key: entry.key,
    label: marketStatusCopy(entry.key, copy),
    active: Boolean(entry.active),
    sortRank: Number(entry.sortRank) || 4,
    localTime: localClockLabel(market.timezone, language, now),
    nextText: countdownToIso(nextTransitionAt, now, language),
    nextTransitionAt,
    reason: language === "en" ? entry.reason : entry.reasonZh || entry.reason,
  };
}

export function marketSessionWindows(market, copy, language, now) {
  const range = (start, end) => displayMarketRange(start, end, market.timezone, language, now);
  if (market.stateModel === "always_open") {
    return [{ key: "trading", label: copy.status.trading, time: copy.alwaysOpen }];
  }
  return (market.sessionTemplates || []).map((session, index) => ({
    key: session.key,
    reactKey: `${session.key}-${index}`,
    label: marketStatusCopy(session.key, copy),
    time: range(session.start, session.end),
  }));
}

export function marketDisplayName(market, language) {
  return language === "en" ? market.displayName : market.displayNameZh || market.displayName;
}

export function marketClockStatuses(dataset, now, language, copy) {
  return Object.fromEntries((dataset?.markets || []).map((market) => [market.id, marketStatus(market, now, language, copy)]));
}

export function marketClockRows(dataset, statuses, showCrypto, copy) {
  const marketOrder = new Map((dataset?.markets || []).map((market, index) => [market.id, index]));
  const markets = new Map((dataset?.markets || []).map((market) => [market.id, market]));
  return (dataset?.assets || [])
    .filter((asset) => showCrypto || asset.market !== "crypto")
    .map((asset) => ({
      asset,
      market: markets.get(asset.market),
      status: assetSessionStatus(
        asset,
        statuses[asset.market] || { key: "closed", label: "Closed", active: false, sortRank: 4 },
        copy?.status,
      ),
    }))
    .sort((a, b) => {
      const aRank = a.asset.market === "crypto" ? 0 : a.status.sortRank;
      const bRank = b.asset.market === "crypto" ? 0 : b.status.sortRank;
      if (aRank !== bRank) return aRank - bRank;
      const marketDiff = (marketOrder.get(a.asset.market) ?? 99) - (marketOrder.get(b.asset.market) ?? 99);
      if (marketDiff) return marketDiff;
      return a.asset.symbol.localeCompare(b.asset.symbol);
    });
}

export function formatClockPrice(asset, copy) {
  if (asset?.price === null || asset?.price === undefined || asset?.price === "" || !Number.isFinite(Number(asset.price))) return copy.unavailableValue;
  const value = Number(asset.price);
  const digits = Math.abs(value) < 1 ? 4 : Math.abs(value) < 100 ? 2 : 2;
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: digits, minimumFractionDigits: value < 1 ? 4 : 0 }).format(value)} ${asset.quote}`;
}

export function formatMarketCapUsd(value, copy) {
  if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) return copy.unavailableValue;
  const number = Number(value);
  const units = [
    [1_000_000_000_000, "T"],
    [1_000_000_000, "B"],
    [1_000_000, "M"],
  ];
  const unit = units.find(([threshold]) => Math.abs(number) >= threshold);
  if (!unit) return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(number)} USD`;
  return `${(number / unit[0]).toFixed(number / unit[0] >= 100 ? 0 : 1)}${unit[1]} USD`;
}

export function marketCapLabel(asset, copy) {
  if (asset.marketCapStatus === "not_applicable") return copy.notApplicable;
  return formatMarketCapUsd(asset.marketCapUsd, copy);
}

export function assetDisplayName(asset, language) {
  return language === "en" ? asset.name : asset.nameZh || asset.name;
}

export function qualityLabel(asset, copy) {
  if (asset.sourceKind === "pending" || !Number.isFinite(Number(asset.price))) return copy.sourcePending;
  if (asset.sourceKind === "proxy") return "Proxy";
  return "OK";
}

export function qualityText(asset) {
  const notes = [];
  if (asset.quality) notes.push(asset.quality);
  if (asset.changeBasis) notes.push(`Change basis: ${asset.changeBasis}.`);
  if (asset.marketCapStatus === "unavailable") notes.push("Market cap unavailable from the current reviewed source.");
  if (asset.marketCapStatus === "not_applicable") notes.push("Market cap does not apply to this proxy/index instrument.");
  return notes.join(" ");
}

export function sourceTimeLabel(iso, language) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "N/A";
  return new Intl.DateTimeFormat(language === "en" ? "en-US" : "zh-CN", {
    timeZone: language === "en" ? "America/New_York" : "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}
