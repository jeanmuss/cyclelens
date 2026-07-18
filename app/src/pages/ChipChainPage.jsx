import { useEffect, useMemo, useState } from "react";
import { formatPct, formatPrice } from "../data.js";
import { CHIP_CHAIN_LIVE_DATA } from "../shared/data/liveDataDefinitions.js";
import { readChipChainStateFromHash, replaceHashState } from "../shared/routing/routeViewState.js";
import { useLiveData } from "../useLiveData.js";
import { PageNav } from "../shared/routing/PageNav.jsx";
import { chipChainCopy, plannedSourceLabel } from "../shared/i18n/chipChain.js";
import {
  chipCategoryRows,
  chipPendingAssets,
  chipTopMovers,
} from "../chipData.js";
import { CacheStatus } from "../shared/components/CacheStatus.jsx";
import { DataFreshnessSummary, DataTrustFooter, buildFreshnessItem } from "../shared/components/DataTrust.jsx";
import { DataState } from "../shared/components/DataState.jsx";
import { LanguageToggle } from "../shared/components/LanguageToggle.jsx";
import { Segmented } from "../shared/components/Segmented.jsx";
import { formatNumber } from "../shared/formatting/metrics.js";
import { currentPage } from "../routeState.js";
import {
  chipHeatClass,
  equityMoveClass,
} from "../domain/supplyChain.js";
import {
  localizedField,
  chipStageLabel,
  chipSourceLabel,
  formatMarketCap,
  formatWeek52Position,
  sourceTimeLabel,
} from "../features/chip-chain/chipChainModel.js";
import { ChainTreemapSummary, ChipSparkline } from "../features/supply-chain/SupplyChainVisuals.jsx";

export function ChipTickerButton({ asset, range, selected, onSelect, copy }) {
  const value = Number(asset.returns?.[range]);
  return (
    <button
      type="button"
      className={`chip-ticker-button ${chipHeatClass(value)} ${selected ? "is-selected" : ""}`}
      onClick={() => onSelect(asset.symbol)}
      aria-pressed={selected}
      title={`${asset.symbol} ${asset.name}`}
    >
      <span>
        <strong>{asset.symbol}</strong>
        <small>{asset.name}</small>
      </span>
      <ChipSparkline asset={asset} range={range} />
      <span>
        <em>{formatPrice(asset.price, asset.quote)}</em>
        <b>{formatPct(value, 1)}</b>
      </span>
    </button>
  );
}

export function ChipCategoryCard({ row, range, selectedSymbol, onSelect, language, copy }) {
  const { category, assets, average, leader } = row;
  return (
    <article className={`chip-category-card ${chipHeatClass(average)}`}>
      <header>
        <div>
          <small>{chipStageLabel(category.stage, copy)}</small>
          <h3>{localizedField(category, "title", language)}</h3>
          <p>{localizedField(category, "subtitle", language)}</p>
        </div>
        <div className="chip-category-score">
          <span>{formatPct(average, 1)}</span>
          <small>{leader?.symbol || "N/A"}</small>
        </div>
      </header>
      <div className="chip-structure-tags" aria-label={localizedField(category, "title", language)}>
        {(language === "en" ? category.structureEn : category.structureZh)?.map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
      </div>
      <div className="chip-ticker-grid">
        {assets.map((asset) => (
          <ChipTickerButton
            asset={asset}
            range={range}
            selected={selectedSymbol === asset.symbol}
            onSelect={onSelect}
            copy={copy}
            key={`${category.id}-${asset.symbol}`}
          />
        ))}
      </div>
    </article>
  );
}

export function ChipChainBoard({ rows, range, selectedSymbol, onSelect, language, copy }) {
  if (!rows.length) {
    return <DataState variant="empty" className="chip-empty-board">{copy.noRows}</DataState>;
  }
  return (
    <div className="chip-chain-board">
      {rows.map((row) => (
        <ChipCategoryCard
          row={row}
          range={range}
          selectedSymbol={selectedSymbol}
          onSelect={onSelect}
          language={language}
          copy={copy}
          key={row.category.id}
        />
      ))}
    </div>
  );
}

export function ChipChainDetail({ asset, category, copy, language }) {
  if (!asset) {
    return (
      <aside className="detail-band detail-empty chip-detail-empty" aria-live="polite">
        <strong>{copy.detailEmptyTitle}</strong>
        <span>{copy.detailEmptyBody}</span>
      </aside>
    );
  }
  const role = language === "en" ? asset.roleEn : asset.roleZh;
  const returnItems = [
    ["1D", asset.returns?.["1d"]],
    ["5D", asset.returns?.["5d"]],
    ["1M", asset.returns?.["1m"]],
    ["3M", asset.returns?.["3m"]],
  ];
  const relativeItems = [
    [copy.vsSoxx, asset.relative?.soxx],
    [copy.vsQqq, asset.relative?.qqq],
  ];
  return (
    <aside className="detail-band chip-detail-band" aria-live="polite">
      <div>
        <small>{copy.selected}</small>
        <strong>{asset.symbol}</strong>
      </div>
      <div>
        <small>{copy.category}</small>
        <strong>{localizedField(category, "title", language)}</strong>
      </div>
      <div>
        <small>{copy.price}</small>
        <strong>{formatPrice(asset.price, asset.quote)}</strong>
      </div>
      <div>
        <small>{copy.returns}</small>
        <strong className="chip-detail-moves">
          {returnItems.map(([label, value]) => (
            <span className={`chip-detail-move ${equityMoveClass(value)}`} key={label}>{label} {formatPct(value, 1)}</span>
          ))}
        </strong>
      </div>
      <div>
        <small>{copy.relative}</small>
        <strong className="chip-detail-moves">
          {relativeItems.map(([label, value]) => (
            <span className={`chip-detail-move ${equityMoveClass(value)}`} key={label}>{label} {formatPct(value, 1)}</span>
          ))}
        </strong>
      </div>
      <div>
        <small>{copy.volume}</small>
        <strong>{formatNumber(asset.volumeRatio, 2)}x</strong>
      </div>
      <div>
        <small>{copy.week52}</small>
        <strong>{formatWeek52Position(asset.week52Position)}</strong>
      </div>
      <div>
        <small>{copy.marketCap}</small>
        <strong>{formatMarketCap(asset.marketCapUsdB)}</strong>
      </div>
      <div>
        <small>{copy.source}</small>
        <strong>{chipSourceLabel(asset, copy)} · {sourceTimeLabel(asset.asOf, language)}</strong>
      </div>
      <div>
        <small>{copy.plannedSource}</small>
        <strong>{plannedSourceLabel(language)}</strong>
      </div>
      <div className="ranking-line">
        <small>{copy.role}</small>
        <strong>{role}</strong>
      </div>
    </aside>
  );
}

export function ChipPendingWatchlist({ assets, categoryById, copy, language }) {
  if (!assets.length) return null;
  return (
    <section className="visualization chip-pending-section" data-testid="chip-pending-watchlist" aria-label={copy.pendingTitle}>
      <div className="visualization-heading">
        <div>
          <p>{copy.pendingKicker}</p>
          <h2>{copy.pendingTitle}</h2>
        </div>
        <p className="method-note">{copy.pendingDescription}</p>
      </div>
      <div className="chip-pending-grid">
        {assets.map((asset) => {
          const category = categoryById.get(asset.primaryCategory);
          return (
            <article className="chip-pending-card" key={asset.symbol}>
              <header>
                <div>
                  <strong>{asset.symbol}</strong>
                  <span>{asset.name}</span>
                </div>
                <small>{localizedField(category, "title", language) || asset.market?.toUpperCase() || "N/A"}</small>
              </header>
              <dl>
                <div><dt>{copy.pendingAsOf}</dt><dd>{sourceTimeLabel(asset.asOf, language)}</dd></div>
                <div><dt>{copy.pendingQuality}</dt><dd>{asset.dataQuality || chipSourceLabel(asset, copy)}</dd></div>
              </dl>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function ChipChainPage({ language, setLanguage, t }) {
  const copy = chipChainCopy(t);
  const { data: liveData, error, freshness: liveFreshness } = useLiveData(CHIP_CHAIN_LIVE_DATA);
  const dataset = liveData.chipChain;
  const freshnessItems = [buildFreshnessItem(language === "en" ? "Chip-chain quotes" : "\u82af\u7247\u94fe\u884c\u60c5", liveFreshness.chipChain, dataset)];
  const [chipState, setChipState] = useState(readChipChainStateFromHash);
  const [selectedSymbol, setSelectedSymbol] = useState(null);
  const [selectionCleared, setSelectionCleared] = useState(false);
  const { range } = chipState;

  useEffect(() => {
    const syncFromHash = () => {
      if (currentPage() !== "chipChain") return;
      setChipState(readChipChainStateFromHash());
    };
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, []);

  useEffect(() => {
    replaceHashState("chip-chain", chipState);
  }, [chipState]);

  const rows = useMemo(() => chipCategoryRows(dataset, range), [dataset, range]);
  const movers = useMemo(() => chipTopMovers(rows, range), [rows, range]);
  const pendingAssets = useMemo(() => chipPendingAssets(dataset), [dataset]);
  const categoryById = useMemo(() => new Map((dataset?.categories || []).map((category) => [category.id, category])), [dataset]);
  const assetMap = dataset?.assets || {};
  const selectedAsset = selectedSymbol ? assetMap[selectedSymbol] : null;
  const selectedCategory = selectedAsset ? categoryById.get(selectedAsset.primaryCategory) : null;
  const rangeOptions = (dataset?.ranges || []).map((item) => ({ value: item.value, label: item.label }));
  const selectChipSymbol = (symbol) => {
    setSelectionCleared(false);
    setSelectedSymbol(symbol);
  };
  const clearChipSelection = () => {
    setSelectionCleared(true);
    setSelectedSymbol(null);
  };
  const clearChipSelectionOnNonTicker = (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest(".chip-ticker-button, .chip-hotspot-card, .chip-treemap-tile, .chip-detail-band, .chip-detail-empty")) return;
    clearChipSelection();
  };

  useEffect(() => {
    if (!dataset) return;
    if (!movers.length) {
      setSelectedSymbol(null);
      return;
    }
    if (selectionCleared) return;
    if (!selectedSymbol || !movers.some((asset) => asset.symbol === selectedSymbol)) {
      setSelectedSymbol(movers[0].symbol);
    }
  }, [dataset, movers, selectedSymbol, selectionCleared]);

  if (error) {
    return <DataState as="main" variant="error" className="status-page"><h1>{copy.unavailable}</h1><p>{error.status ? `${t.status.dataFileFailed} (${error.status})` : error.message}</p></DataState>;
  }
  if (!dataset) {
    return <DataState as="main" variant="loading" className="status-page"><p>{copy.loading}</p></DataState>;
  }

  return (
    <main className="app-page chip-chain-page" onPointerDown={clearChipSelectionOnNonTicker}>
      <header className="app-header">
        <div className="title-block">
          <p className="eyebrow">{copy.eyebrow}</p>
          <h1><span>{copy.titleAccent}</span> {copy.titleRest}</h1>
          <p>{copy.subtitle}</p>
          <PageNav page="chipChain" t={t} />
        </div>
        <div className="freshness-block">
          <LanguageToggle language={language} onChange={setLanguage} t={t} />
          <CacheStatus label={copy.cache} tooltip={copy.cacheTooltip} />
          <DataFreshnessSummary items={freshnessItems} language={language} t={t} />
          <small>{dataset.failures?.length ? copy.failure(dataset.failures.length) : copy.success}</small>
        </div>
      </header>

      <ChainTreemapSummary movers={movers} range={range} selectedSymbol={selectedSymbol} onSelect={selectChipSymbol} copy={copy} />

      <section className="control-bar chip-chain-controls" aria-label={copy.controls}>
        <div className="control-primary">
          <Segmented label={copy.range} options={rangeOptions} value={range} onChange={(next) => setChipState((current) => ({ ...current, range: next }))} />
        </div>
      </section>

      <section className="visualization chip-chain-section" aria-label={copy.boardTitle}>
        <div className="visualization-heading">
          <div>
            <p>{copy.boardKicker}</p>
            <h2>{copy.boardTitle}</h2>
          </div>
          <p className="method-note">{copy.rankingMethod}</p>
        </div>
        <ChipChainBoard rows={rows} range={range} selectedSymbol={selectedSymbol} onSelect={selectChipSymbol} language={language} copy={copy} />
      </section>

      <ChipPendingWatchlist assets={pendingAssets} categoryById={categoryById} copy={copy} language={language} />

      {selectedAsset ? <ChipChainDetail asset={selectedAsset} category={selectedCategory} copy={copy} language={language} /> : null}

      <DataTrustFooter
        t={t}
        language={language}
        freshnessItems={freshnessItems}
        failures={dataset.failures}
        sources={[
          plannedSourceLabel(language),
          copy.cacheSource || copy.sampleSource,
        ]}
        methodology={copy.rankingMethod}
        limitations={[copy.sourceNote, copy.pendingDescription]}
      />
    </main>
  );
}
