import { freshnessLabel } from "../../data.js";
import { METRIC_CATALOG_BY_ID } from "../../domain/metrics/metricCatalog.js";
import { formatDashboardValue, metricSnapshot } from "./dashboardModel.js";

function qualityLabel(status, copy) {
  if (!status) return copy.qualityUnknown;
  if (/stale|fallback|last_known_good/i.test(status)) return copy.qualityStale;
  if (/official|available|verified/i.test(status)) return copy.qualityAvailable;
  return copy.qualityDerived;
}

export function MetricListWidget({ definition, language, metricMap, copy }) {
  return (
    <article className={`dashboard-widget is-${definition.size}`} data-widget-id={definition.id}>
      <header>
        <div>
          <p>{definition.markets.join(" · ").toUpperCase()}</p>
          <h2>{definition.title[language]}</h2>
        </div>
        <span>{definition.metricIds.length} {copy.metrics}</span>
      </header>
      <p className="dashboard-widget-description">{definition.description[language]}</p>
      <div className="dashboard-metric-list">
        {definition.metricIds.map((metricId) => {
          const snapshot = metricSnapshot(metricMap.get(metricId));
          const title = snapshot.metric?.title?.[language]
            || METRIC_CATALOG_BY_ID[metricId]?.title?.[language]
            || metricId;
          if (!snapshot.latest) {
            return (
              <div className="dashboard-metric is-unavailable" key={metricId}>
                <div><small>{title}</small><strong>N/A</strong></div>
                <p><span>{copy.notPublished}</span><span>{copy.qualityUnknown}</span></p>
              </div>
            );
          }
          return (
            <div className="dashboard-metric" key={metricId} data-quality={snapshot.latest.qualityStatus}>
              <div>
                <small>{title}</small>
                <strong>{formatDashboardValue(snapshot.metric, snapshot.latestValue, language)}</strong>
              </div>
              <p>
                <span>{copy.updated}: {freshnessLabel(snapshot.latest.observedAt, language)}</span>
                <span>{copy.quality}: {qualityLabel(snapshot.latest.qualityStatus, copy)}</span>
              </p>
            </div>
          );
        })}
      </div>
    </article>
  );
}
