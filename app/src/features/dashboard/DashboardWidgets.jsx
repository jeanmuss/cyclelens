import { METRIC_CATALOG_BY_ID } from "../../domain/metrics/metricCatalog.js";
import { formatDashboardChange, formatDashboardValue, metricSnapshot } from "./dashboardModel.js";

function changeClass(change) {
  if (!change || !Number.isFinite(Number(change.value)) || Number(change.value) === 0) return "is-flat";
  return Number(change.value) > 0 ? "is-up" : "is-down";
}

function MetricChanges({ metric, snapshot, language, copy }) {
  return (
    <dl className="dashboard-metric-changes">
      <div><dt>{copy.dayChange}</dt><dd className={changeClass(snapshot.dayChange)}>{formatDashboardChange(metric, snapshot.dayChange, language)}</dd></div>
      <div><dt>{copy.weekChange}</dt><dd className={changeClass(snapshot.weekChange)}>{formatDashboardChange(metric, snapshot.weekChange, language)}</dd></div>
    </dl>
  );
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
                <MetricChanges metric={METRIC_CATALOG_BY_ID[metricId]} snapshot={snapshot} language={language} copy={copy} />
              </div>
            );
          }
          return (
            <div className="dashboard-metric" key={metricId} data-quality={snapshot.latest.qualityStatus}>
              <div>
                <small>{title}</small>
                <strong>{formatDashboardValue(snapshot.metric, snapshot.latestValue, language)}</strong>
              </div>
              <MetricChanges metric={snapshot.metric} snapshot={snapshot} language={language} copy={copy} />
            </div>
          );
        })}
      </div>
    </article>
  );
}
