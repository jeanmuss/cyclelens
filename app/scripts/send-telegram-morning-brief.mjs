import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  TELEGRAM_TEXT_LIMIT,
  telegramPlainTextLength,
  validateTelegramMorningBrief,
} from "./telegram-morning-brief-contract.mjs";

const TELEGRAM_API_ORIGIN = "https://api.telegram.org";
const MAX_TELEGRAM_RESPONSE_BYTES = 64 * 1024;

export class TelegramDeliveryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "TelegramDeliveryError";
    this.code = code;
  }
}

function validToken(value) {
  return typeof value === "string" && value.length >= 20 && value.length <= 200 && !/\s/.test(value);
}

function validChatId(value) {
  return typeof value === "string" && (/^-?\d+$/.test(value) || /^@[A-Za-z][A-Za-z0-9_]{4,31}$/.test(value));
}

async function wait(milliseconds) {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function boundedResponseJson(response) {
  const declaredLength = response.headers?.get?.("content-length") ?? null;
  if (declaredLength != null) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_TELEGRAM_RESPONSE_BYTES) {
      throw new TelegramDeliveryError("outcome_unknown", "Telegram returned an oversized response.");
    }
  }
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_TELEGRAM_RESPONSE_BYTES) {
        await reader.cancel();
        throw new TelegramDeliveryError("outcome_unknown", "Telegram returned an oversized response.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new TelegramDeliveryError("outcome_unknown", "Telegram returned an unreadable response.");
  }
}

async function postMessage({ token, chatId, html, fetchImpl, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${TELEGRAM_API_ORIGIN}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: html,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      redirect: "error",
      signal: controller.signal,
    });
    return {
      status: response.status,
      ok: response.ok,
      payload: await boundedResponseJson(response),
    };
  } catch {
    throw new TelegramDeliveryError(
      "outcome_unknown",
      "Telegram delivery outcome is unknown; automatic retry is disabled to avoid a duplicate.",
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function sendTelegramMorningBrief({
  report,
  token,
  chatId,
  fetchImpl = fetch,
  delay = wait,
  timeoutMs = 10_000,
}) {
  const errors = validateTelegramMorningBrief(report);
  if (errors.length || typeof report?.telegramHtml !== "string") {
    throw new TelegramDeliveryError("invalid_report", "The Telegram morning brief snapshot is invalid.");
  }
  if (!validToken(token) || !validChatId(chatId)) {
    throw new TelegramDeliveryError("invalid_configuration", "Telegram delivery secrets are missing or invalid.");
  }
  if (telegramPlainTextLength(report.telegramHtml) > TELEGRAM_TEXT_LIMIT) {
    throw new TelegramDeliveryError("message_too_long", "The Telegram morning brief exceeds the message limit.");
  }

  let response = await postMessage({ token, chatId, html: report.telegramHtml, fetchImpl, timeoutMs });
  if (response.status === 429) {
    let retryAfter = 0;
    retryAfter = Number(response.payload?.parameters?.retry_after || 0);
    if (!Number.isInteger(retryAfter) || retryAfter < 1 || retryAfter > 30) {
      throw new TelegramDeliveryError("rate_limited", "Telegram rate limit did not provide a safe retry window.");
    }
    await delay(retryAfter * 1000);
    response = await postMessage({ token, chatId, html: report.telegramHtml, fetchImpl, timeoutMs });
  }

  if (response.status >= 500) {
    throw new TelegramDeliveryError(
      "outcome_unknown",
      "Telegram delivery outcome is unknown; automatic retry is disabled to avoid a duplicate.",
    );
  }
  if (!response.ok) {
    throw new TelegramDeliveryError("rejected", `Telegram rejected the request (HTTP ${response.status}).`);
  }
  const payload = response.payload;
  if (payload?.ok !== true) throw new TelegramDeliveryError("rejected", "Telegram rejected the request.");
  return {
    schemaVersion: 1,
    contractVersion: report.contractVersion,
    deliveryKey: report.deliveryKey,
    shanghaiDate: report.shanghaiDate,
    sentAt: new Date().toISOString(),
    outcome: "accepted",
  };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  console.error("Telegram delivery is retired for the owner-only product boundary.");
  process.exitCode = 1;
}
