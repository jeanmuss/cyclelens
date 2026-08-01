import { METRIC_CATALOG_BY_ID } from "../src/domain/metrics/metricCatalog.js";
import {
  sourceIsEligibleForDataUse,
  sourcePolicyForObservation,
} from "../src/domain/metrics/sourcePolicy.js";
import { DATA_USE_SCOPES, normalizeDataUseScope } from "./data-use-scope.mjs";

export function validateObservationRows(rows, options = {}) {
  const environment = options.environment || process.env;
  const scope = normalizeDataUseScope(options.scope, DATA_USE_SCOPES.PUBLIC);
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
    else if (!sourceIsEligibleForDataUse(sourcePolicy, { scope, environment })) {
      reason = scope === DATA_USE_SCOPES.OWNER_PRIVATE
        ? "source_not_approved_for_owner_private_use"
        : "source_not_approved_for_public_redistribution";
    }

    if (reason) {
      rejected.push({ metricId: observation?.metric_id || null, reason });
    } else {
      accepted.push({ ...observation, source_policy_id: sourcePolicy.id, data_use_scope: scope });
    }
  }

  return { accepted, rejected };
}
