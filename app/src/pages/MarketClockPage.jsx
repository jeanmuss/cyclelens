import { useEffect, useMemo, useState } from "react";
import { formatPct } from "../data.js";
import { MARKET_CLOCK_LIVE_DATA } from "../shared/data/liveDataDefinitions.js";
import { replaceHashState } from "../shared/routing/routeViewState.js";
import { useLiveData } from "../useLiveData.js";
import { PageNav } from "../shared/routing/PageNav.jsx";
import { marketClockCopy } from "../shared/i18n/marketClock.js";
import { writeShowCryptoPreference } from "../localPreferences.js";
import { CacheStatus } from "../shared/components/CacheStatus.jsx";
import { DataFreshnessSummary, DataTrustFooter, buildFreshnessItem } from "../shared/components/DataTrust.jsx";
import { DataState } from "../shared/components/DataState.jsx";
import { LanguageToggle } from "../shared/components/LanguageToggle.jsx";
import {
  getInitialShowCrypto,
  marketSessionWindows,
  marketDisplayName,
  marketClockStatuses,
  marketClockRows,
  formatClockPrice,
  marketCapLabel,
  assetDisplayName,
  qualityLabel,
  qualityText,
  sourceTimeLabel,
} from "../features/market-clock/marketClockModel.js";

export function MarketClockSummary({ dataset, statuses, language, copy, now }) {
  return (
    <section className="market-clock-summary" aria-label={copy.marketState}>
      {(dataset.markets || []).map((market) => {
        const status = statuses[market.id];
        return (
          <div className={`market-state-card state-${status?.key || "closed"} market-${market.id}`} key={market.id}>
            <small>{marketDisplayName(market, language)}</small>
            <strong>{status?.label || copy.status.closed}</strong>
            <span>{copy.localTime}: {status?.localTime || "N/A"}</span>
            <em>{copy.next}: {status?.nextText || "N/A"}</em>
            {status?.reason ? <small className="market-state-reason">{status.reason}</small> : null}
            <div className="market-session-strip" aria-label={`${marketDisplayName(market, language)} ${copy.sessions}`}>
              {marketSessionWindows(market, copy, language, now).map((session) => (
                <span className={`market-session-chip state-${session.key}`} key={`${market.id}-${session.reactKey || session.key}`}>
                  <b>{session.label}</b>
                  <i>{session.time}</i>
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}

export function MarketClockTable({ rows, selected, onSelect, language, copy }) {
  return (
    <div className="table-shell market-clock-shell">
      <table className="data-table market-clock-table">
        <caption className="sr-only">{copy.assetList}</caption>
        <thead>
          <tr>
            <th>{copy.table.market}</th>
            <th>{copy.table.asset}</th>
            <th>{copy.table.status}</th>
            <th>{copy.table.price}</th>
            <th>{copy.table.change}</th>
            <th>{copy.table.marketCap}</th>
            <th>{copy.table.source}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? rows.map(({ asset, market, status }) => {
            const isSelected = selected?.symbol === asset.symbol;
            return (
              <tr className={`${isSelected ? "selected-row" : ""} state-${status.key}`} key={asset.symbol}>
                <th scope="row">
                  <button type="button" onClick={() => onSelect(asset)}>
                    <strong>{market ? marketDisplayName(market, language) : asset.market}</strong>
                    <span>{market?.timezone || "UTC"}</span>
                  </button>
                </th>
                <td>
                  <button type="button" className="market-asset-button" onClick={() => onSelect(asset)}>
                    <strong>{asset.symbol}</strong>
                    <span>{assetDisplayName(asset, language)}</span>
                  </button>
                </td>
                <td><span className={`market-status-pill state-${status.key}`}>{status.label}</span></td>
                <td>{formatClockPrice(asset, copy)}</td>
                <td className={Number(asset.changePct) >= 0 ? "positive" : Number(asset.changePct) < 0 ? "negative" : ""}>{formatPct(asset.changePct, 2)}</td>
                <td>{marketCapLabel(asset, copy)}</td>
                <td>
                  <button type="button" className={`quality-badge source-${asset.sourceKind || "available"}`} title={qualityText(asset)} onClick={() => onSelect(asset)}>
                    {qualityLabel(asset, copy)}
                  </button>
                </td>
              </tr>
            );
          }) : (
            <tr>
              <DataState as="td" variant="empty" colSpan="7" className="empty-table-cell">{copy.table.noRows}</DataState>
            </tr>
          )}
        </tbody>
      </table>
      <div className="table-note">{copy.sourceNote}</div>
    </div>
  );
}

export function MarketClockDetail({ selected, copy, language }) {
  if (!selected) {
    return (
      <aside className="detail-band detail-empty market-clock-detail-empty" aria-live="polite">
        <strong>{copy.detail.emptyTitle}</strong>
        <span>{copy.detail.emptyBody}</span>
      </aside>
    );
  }
  const components = selected.components?.length
    ? selected.components.map((component) => `${component.exchange} ${component.symbol} ${Number.isFinite(component.weight) ? `${Math.round(component.weight * 100)}%` : ""}`).join(" / ")
    : "N/A";
  return (
    <aside className="detail-band market-clock-detail" aria-live="polite">
      <div>
        <small>{copy.detail.selected}</small>
        <strong>{selected.symbol}</strong>
      </div>
      <div>
        <small>{copy.detail.pair}</small>
        <strong>{selected.localQuote ? `${selected.localQuote} → ${selected.quote}` : selected.quote}</strong>
      </div>
      <div>
        <small>{copy.table.price}</small>
        <strong>{formatClockPrice(selected, copy)}</strong>
      </div>
      <div>
        <small>{copy.table.marketCap}</small>
        <strong>{marketCapLabel(selected, copy)}</strong>
      </div>
      <div>
        <small>{copy.detail.priceSource}</small>
        <strong>{selected.sourceLabel || "N/A"}</strong>
      </div>
      <div>
        <small>{copy.detail.capSource}</small>
        <strong>{selected.marketCapSourceLabel || (selected.marketCapStatus === "not_applicable" ? copy.notApplicable : copy.sourcePending)}</strong>
      </div>
      <div>
        <small>{copy.detail.updated}</small>
        <strong>{sourceTimeLabel(selected.asOf || selected.marketCapAsOf, language)}</strong>
      </div>
      <div className="ranking-line">
        <small>{copy.detail.quality}</small>
        <strong>{qualityText(selected) || "N/A"}</strong>
      </div>
      <div className="ranking-line">
        <small>{copy.detail.components}</small>
        <strong>{components}</strong>
      </div>
    </aside>
  );
}

export function MarketClockTradingLimits({ copy }) {
  const tradingLimits = copy.tradingLimits;
  if (!tradingLimits?.markets?.length) return null;

  return (
    <section className="visualization market-limit-section" aria-label={tradingLimits.title}>
      <div className="visualization-heading market-limit-heading">
        <div>
          <p>{tradingLimits.kicker}</p>
          <h2>{tradingLimits.title}</h2>
          <p className="market-limit-intro">
            {(tradingLimits.introLines || [tradingLimits.note]).map((line) => (
              <span key={line}>{line}</span>
            ))}
          </p>
        </div>
      </div>
      <div className="market-limit-grid">
        {tradingLimits.markets.map((market) => (
          <article className="market-limit-market" key={market.market}>
            <header>
              <h3>{market.market}</h3>
              <p>{market.summary}</p>
            </header>
            <dl>
              {market.sessions.map(([label, limit]) => (
                <div key={`${market.market}-${label}`}>
                  <dt>{label}</dt>
                  <dd>{limit}</dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>
      <p className="market-limit-sources">
        <strong>{tradingLimits.sourcesLabel}</strong>
        <span>{tradingLimits.sources}</span>
      </p>
    </section>
  );
}

export function MarketClockPage({ language, setLanguage, t }) {
  const copy = useMemo(() => marketClockCopy(t), [t]);
  const { data: liveData, error, freshness: liveFreshness } = useLiveData(MARKET_CLOCK_LIVE_DATA);
  const dataset = liveData.marketSession;
  const freshnessItems = [buildFreshnessItem(language === "en" ? "Quotes / calendars" : "\u884c\u60c5 / \u4ea4\u6613\u65e5\u5386", liveFreshness.marketSession, dataset)];
  const [now, setNow] = useState(() => new Date());
  const [showCrypto, setShowCrypto] = useState(getInitialShowCrypto);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    replaceHashState("market-clock", {});
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    writeShowCryptoPreference(showCrypto);
    if (!showCrypto && selected?.market === "crypto") setSelected(null);
  }, [showCrypto, selected]);

  const statuses = useMemo(() => dataset ? marketClockStatuses(dataset, now, language, copy) : {}, [dataset, now, language, copy]);
  const rows = useMemo(() => dataset ? marketClockRows(dataset, statuses, showCrypto, copy) : [], [dataset, statuses, showCrypto, copy]);

  useEffect(() => {
    setSelected((current) => {
      if (!current) return current;
      return rows.find((row) => row.asset.symbol === current.symbol && row.asset.market === current.market)?.asset || null;
    });
  }, [rows]);

  if (error) {
    return <DataState as="main" variant="error" className="status-page"><h1>{copy.unavailable}</h1><p>{error.status ? `${t.status.dataFileFailed} (${error.status})` : error.message}</p></DataState>;
  }
  if (!dataset) {
    return <DataState as="main" variant="loading" className="status-page"><p>{copy.loading}</p></DataState>;
  }

  return (
    <main className="app-page market-clock-page">
      <header className="app-header">
        <div className="title-block">
          <p className="eyebrow">{copy.eyebrow}</p>
          <h1><span>{copy.titleAccent}</span> {copy.titleRest}</h1>
          <p>{copy.subtitle}</p>
          <PageNav page="marketClock" t={t} />
        </div>
        <div className="freshness-block">
          <LanguageToggle language={language} onChange={setLanguage} t={t} />
          <CacheStatus label={copy.cache} tooltip={copy.cacheTooltip} />
          <DataFreshnessSummary items={freshnessItems} language={language} t={t} />
          <small>{dataset.failures?.length ? copy.failure(dataset.failures.length) : copy.success}</small>
        </div>
      </header>

      <MarketClockSummary dataset={dataset} statuses={statuses} language={language} copy={copy} now={now} />

      <section className="control-bar market-clock-controls" aria-label={copy.controls}>
        <div className="control-primary">
          <button type="button" className={showCrypto ? "market-toggle is-active" : "market-toggle"} onClick={() => setShowCrypto((value) => !value)}>
            {showCrypto ? copy.hideCrypto : copy.showCrypto}
          </button>
        </div>
        <div className="control-secondary">
          <span className="market-clock-hidden-note">{showCrypto ? "" : copy.cryptoHidden}</span>
        </div>
      </section>

      <section className="visualization market-clock-section" aria-label={copy.assetList}>
        <div className="visualization-heading">
          <div>
            <p>{copy.marketState}</p>
            <h2>{copy.assetList}</h2>
          </div>
          <p className="method-note">{dataset.refreshCadence}</p>
        </div>
        <MarketClockTable rows={rows} selected={selected} onSelect={setSelected} language={language} copy={copy} />
      </section>

      <MarketClockDetail selected={selected} copy={copy} language={language} />

      <MarketClockTradingLimits copy={copy} />

      <DataTrustFooter
        t={t}
        language={language}
        freshnessItems={freshnessItems}
        failures={dataset.failures}
        sources={[
          "OKX public market data",
          "CoinMarketCap market caps",
          "NYSE / KRX / SSE official calendars",
          copy.tradingLimits.sources,
        ]}
        methodology={copy.methodology || dataset.methodology}
        limitations={[copy.sourceNote, copy.tradingLimits.note]}
      />
    </main>
  );
}
