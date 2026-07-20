import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  TELEGRAM_TEXT_LIMIT,
  telegramPlainTextLength,
  validateTelegramMorningBrief,
} from "./telegram-morning-brief-contract.mjs";

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

async function postMessage({ token, chatId, html, fetchImpl, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: html,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    });
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
    try {
      const payload = await response.json();
      retryAfter = Number(payload?.parameters?.retry_after || 0);
    } catch {
      retryAfter = 0;
    }
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
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new TelegramDeliveryError("outcome_unknown", "Telegram returned an unreadable success response.");
  }
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

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

async function main() {
  const briefPath = resolve(option("--brief", ".artifacts/telegram-morning-brief/brief.json"));
  const receiptPath = resolve(option("--receipt", ".artifacts/telegram-morning-brief/receipt.json"));
  const report = JSON.parse(await readFile(briefPath, "utf8"));
  const receipt = await sendTelegramMorningBrief({
    report,
    token: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
  });
  await mkdir(dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(`Telegram accepted ${receipt.deliveryKey}; a redacted delivery receipt was created.`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  main().catch((error) => {
    const message = error instanceof TelegramDeliveryError
      ? error.message
      : "Telegram delivery failed before a safe receipt could be created.";
    console.error(message);
    process.exitCode = 1;
  });
}
