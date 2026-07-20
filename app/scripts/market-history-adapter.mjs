import { METRIC_CATALOG_BY_ID } from "../src/domain/metrics/metricCatalog.js";
import { defineMetricAdapter } from "./metric-adapter-contract.mjs";
import {
  dedupeMarketMetricRows,
  extractCryptoHistoryRows,
  extractEquityDashboardRows,
  extractJapanRateRows,
  extractMacroDashboardRows,
  hydrateCryptoDatasetFromRows,
  selectIncrementalObservationRows,
} from "./market-metric-history-contract.mjs";
import { validateObservationRows } from "./metric-observation-contract.mjs";

export const MARKET_HISTORY_CONFLICT_FIELDS = Object.freeze([
  "metric_id",
  "observed_at",
  "source_key",
]);

export function createMarketHistoryAdapter(dependencies) {
  return defineMetricAdapter({
    id: "market-history",
    async fetch(context) {
      const inputs = await dependencies.readInputs();
      const latestJgb = await dependencies.latestJapanObservation();
      return { ...inputs, latestJgb, environment: context.environment || process.env };
    },
    async normalize(input) {
      const cryptoRows = extractCryptoHistoryRows(input.crypto);
      const japanRows = selectIncrementalObservationRows(
        extractJapanRateRows(input.jgbCache, input.equity),
        input.latestJgb,
        { initialBackfillDays: 400, overlapDays: 14 },
      );
      const equityDashboardRows = extractEquityDashboardRows(input.equity, input.equityFast);
      const macroDashboardRows = extractMacroDashboardRows(input.macro);
      return {
        ...input,
        cryptoRows,
        japanRows,
        equityDashboardRows,
        macroDashboardRows,
        rows: dedupeMarketMetricRows([
          ...cryptoRows,
          ...japanRows,
          ...equityDashboardRows,
          ...macroDashboardRows,
        ]),
      };
    },
    async validate(input) {
      const validation = validateObservationRows(input.rows, { environment: input.environment });
      if (!validation.accepted.length) throw new Error("No reviewed market metric observations were available to persist");
      return { ...input, rows: validation.accepted, rejectedRows: validation.rejected };
    },
    async persist(input) {
      const persistenceRows = input.rows.map(({ source_policy_id: ignored, ...row }) => row);
      await dependencies.upsertRows(persistenceRows, { conflictFields: MARKET_HISTORY_CONFLICT_FIELDS });
      const databaseRows = await dependencies.readCryptoHistoryRows();
      const validation = validateObservationRows(databaseRows, { environment: input.environment });
      return { ...input, databaseRows: validation.accepted, databaseRejectedRows: validation.rejected };
    },
    async project(input) {
      const hydrationRows = input.databaseRows.map(({ source_policy_id: ignored, ...row }) => row);
      const hydratedCrypto = hydrationRows.length
        ? hydrateCryptoDatasetFromRows(input.crypto, hydrationRows, new Date().toISOString())
        : input.crypto;
      if (hydrationRows.length) await dependencies.writeCryptoDataset(hydratedCrypto);
      return {
        hydratedCrypto,
        persistedRows: input.rows.length,
        cryptoRows: input.cryptoRows.length,
        japanRows: input.japanRows.length,
        equityDashboardRows: input.equityDashboardRows.length,
        macroDashboardRows: input.macroDashboardRows.length,
        databaseRows: hydrationRows.length,
        rejectedRows: input.rejectedRows.length + input.databaseRejectedRows.length,
        metricIds: [...new Set(input.rows.map((item) => item.metric_id))]
          .filter((id) => METRIC_CATALOG_BY_ID[id])
          .sort(),
      };
    },
  });
}
