import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  createTelegramMorningBrief,
  renderTelegramMorningBriefHtml,
  telegramPlainTextLength,
} from "./telegram-morning-brief-contract.mjs";

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const projectionPath = resolve(option("--projection", "public/data/projections/dashboard.json"));
const outputDirectory = resolve(option("--output-dir", ".artifacts/telegram-morning-brief"));
const nowValue = option("--now", new Date().toISOString());

const projection = JSON.parse(await readFile(projectionPath, "utf8"));
const report = createTelegramMorningBrief(projection, nowValue);
const html = renderTelegramMorningBriefHtml(report);
const snapshot = { ...report, telegramHtml: html, plainTextLength: telegramPlainTextLength(html) };

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(resolve(outputDirectory, "brief.json"), `${JSON.stringify(snapshot, null, 2)}\n`, "utf8"),
  writeFile(resolve(outputDirectory, "brief.html"), `${html}\n`, "utf8"),
]);

if (process.env.GITHUB_OUTPUT) {
  const receiptArtifact = `telegram-receipt-${report.deliveryKey}`;
  await appendFile(process.env.GITHUB_OUTPUT, `delivery_key=${report.deliveryKey}\nreceipt_artifact=${receiptArtifact}\n`, "utf8");
}

console.log(`Rendered Telegram morning brief ${report.deliveryKey}: ${report.summary.total} metrics, ${report.summary.missing} N/A, ${snapshot.plainTextLength} characters.`);
