import { delayLabel, freshnessLabel } from "../../data.js";
import { textBlock } from "../formatting/metrics.js";

export function buildFreshnessItem(label, metadata, dataset) {
  const timestamps = dataset?.timestamps || {};
  return {
    label,
    observedAt: metadata?.observedAt || timestamps.observedAt || null,
    fetchedAt: metadata?.fetchedAt || timestamps.fetchedAt || null,
    transformedAt: metadata?.transformedAt || timestamps.transformedAt || dataset?.generatedAt || null,
    deployedAt: metadata?.deployedAt || null,
    clientCheckedAt: metadata?.clientCheckedAt || null,
    timestampFallback: metadata?.timestampFallback || null,
  };
}

export function TimestampValue({ value, language, unknown }) {
  if (!value) return <span>{unknown}</span>;
  return (
    <span data-timestamp={value} title={freshnessLabel(value, language)}>
      <b>{delayLabel(value, language)}</b>
      <small>{freshnessLabel(value, language)}</small>
    </span>
  );
}

export function DataFreshnessSummary({ items, language, t }) {
  return (
    <div className="freshness-summary" data-testid="freshness-summary">
      {items.map((item) => (
        <strong key={item.label} title={`${t.footer.observedAt}: ${freshnessLabel(item.observedAt, language)}; ${t.footer.clientCheckedAt}: ${freshnessLabel(item.clientCheckedAt, language)}`}>
          <span>{item.label}</span>
          {t.footer.observedAt} {delayLabel(item.observedAt, language)} 路 {t.footer.clientCheckedAt} {delayLabel(item.clientCheckedAt, language)}
        </strong>
      ))}
    </div>
  );
}

export function FreshnessAuditTable({ items, language, t }) {
  const fields = ["observedAt", "fetchedAt", "transformedAt", "deployedAt", "clientCheckedAt"];
  return (
    <div className="freshness-audit-shell">
      <table className="freshness-audit-table" data-testid="freshness-audit">
        <caption>{t.footer.timeAudit}</caption>
        <thead>
          <tr>
            <th scope="col">{t.footer.dataset}</th>
            {fields.map((field) => <th scope="col" key={field}>{t.footer[field]}</th>)}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.label}>
              <th scope="row">{item.label}</th>
              {fields.map((field) => <td key={field}><TimestampValue value={item[field]} language={language} unknown={t.footer.unknown} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {items.some((item) => item.timestampFallback) ? <p className="timestamp-fallback-note">{t.footer.legacyTimestamp}</p> : null}
    </div>
  );
}

export function DataTrustFooter({
  t,
  language,
  freshnessItems = [],
  sources = [],
  methodology,
  limitations,
  failures = 0,
}) {
  const failureCount = Array.isArray(failures) ? failures.length : Number(failures) || 0;
  const sourceItems = sources.filter(Boolean);
  const methodologyText = textBlock(methodology) || t.footer.unknown;
  const limitationsText = textBlock(limitations) || t.footer.staticCacheOnly;
  return (
    <footer className="source-footer data-trust-footer">
      <div className="data-trust-top">
        <div>
          <strong>{t.footer.trustTitle}</strong>
          <span className={`data-trust-status ${failureCount ? "is-partial" : "is-healthy"}`}>
            {failureCount ? t.footer.partialStatus(failureCount) : t.footer.healthyStatus}
          </span>
        </div>
      </div>
      <FreshnessAuditTable items={freshnessItems} language={language} t={t} />
      <div className="data-trust-grid">
        <section>
          <small>{t.footer.sources}</small>
          <div className="data-trust-tags">
            {sourceItems.length ? sourceItems.map((source) => <span key={source}>{source}</span>) : <span>{t.footer.unknown}</span>}
          </div>
        </section>
        <section>
          <small>{t.footer.methodology}</small>
          <p>{methodologyText}</p>
        </section>
        <section>
          <small>{t.footer.limitations}</small>
          <p>{limitationsText}</p>
        </section>
      </div>
    </footer>
  );
}
