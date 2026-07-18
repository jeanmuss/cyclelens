import { METRIC_CATALOG_BY_ID } from "../src/domain/metrics/metricCatalog.js";
import {
  sourceIsProductionEligible,
  sourcePolicyForObservation,
} from "../src/domain/metrics/sourcePolicy.js";

export function validateObservationRows(rows, options = {}) {
  const environment = options.environment || process.env;
  const accepted = [];
  const rejected = [];

  for (const observation of rows || []) {
    const catalogEntry = METRIC_CATALOG_BY_ID[observation?.metric_id];
    const sourcePolicy = sourcePolicyForObservation(observation);
    let reason = null;
    if (!catalogEntry) reason = "metric_not_cataloged";
    else if (observation.unit !== catalogEntry.unit) reason = "unit_mismatch";
    else if (observation.cadence !== catalogEntry.cadence) reason = "cadence_mismatch";
    else if (!sourcePolicy) reason = "source_not_reviewed";
    else if (!catalogEntry.sourcePolicyIds.includes(sourcePolicy.id)) reason = "source_not_allowed_for_metric";
    else if (!sourceIsProductionEligible(sourcePolicy, environment)) reason = "source_not_approved_for_production";

    if (reason) {
      rejected.push({ metricId: observation?.metric_id || null, reason });
    } else {
      accepted.push({ ...observation, source_policy_id: sourcePolicy.id });
    }
  }

  return { accepted, rejected };
}
