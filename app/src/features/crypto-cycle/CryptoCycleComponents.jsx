import { Fragment } from "react";
import {
  ASSETS,
  HALVING_MONTHS,
  formatPct,
  formatPrice,
  isCycleGroupStartYear,
  returnClass,
} from "../../data.js";
import { optionLabel } from "../../shared/formatting/metrics.js";
import { cycleLabel, extremeMoveMeta } from "../../shared/i18n/crypto.js";

export function AssetSwitch({ value, onChange, t }) {
  return (
    <div className="asset-switch" role="group" aria-label={t.controls.asset}>
      {ASSETS.map((asset) => (
        <button
          type="button"
          key={asset.symbol}
          className={`${asset.accent} ${value === asset.symbol ? "is-active" : ""}`}
          aria-pressed={value === asset.symbol}
          onClick={() => onChange(asset.symbol)}
        >
          <strong>{asset.symbol}</strong>
          <span>{asset.name}</span>
        </button>
      ))}
    </div>
  );
}

export function yearBackground(index, count) {
  const ratio = count > 1 ? 1 - index / (count - 1) : 0;
  return `rgb(${Math.round(255 - 70 * ratio)}, ${Math.round(255 - 38 * ratio)}, 255)`;
}

export function HeatCell({
  symbol,
  monthKey,
  row,
  value,
  rowKey,
  columnKey,
  hover,
  setHover,
  setTooltip,
  onSelect,
  showNA = true,
  t,
}) {
  const isHalving = HALVING_MONTHS.has(monthKey);
  const classNames = [
    "heat-cell",
    returnClass(value),
    isHalving ? "halving-cell" : "",
    hover?.rowKey === rowKey ? "cross-row" : "",
    hover?.columnKey === columnKey ? "cross-column" : "",
  ].filter(Boolean).join(" ");
  const label = `${symbol} ${monthKey} ${Number.isFinite(value) ? formatPct(value) : t.tables.noData}`;

  const revealTooltip = (event) => {
    setTooltip({ x: event.clientX, y: event.clientY, symbol, monthKey, row, value });
  };

  const activate = () => {
    if (row) {
      setTooltip(null);
      onSelect({ symbol, monthKey, row, value });
    }
  };

  return (
    <td
      className={classNames}
      tabIndex={row ? 0 : -1}
      role={row ? "button" : undefined}
      aria-label={label}
      onMouseEnter={(event) => {
        setHover({ rowKey, columnKey });
        revealTooltip(event);
      }}
      onMouseMove={revealTooltip}
      onMouseLeave={() => {
        setHover(null);
        setTooltip(null);
      }}
      onClick={activate}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activate();
        }
      }}
    >
      {Number.isFinite(value) ? formatPct(value) : showNA ? "N/A" : ""}
    </td>
  );
}

export function TotalCell({
  symbol,
  year,
  row,
  value,
  rowKey,
  hover,
  setHover,
  setTooltip,
  onSelect,
  t,
}) {
  const classNames = [
    "total-cell",
    returnClass(value),
    hover?.rowKey === rowKey ? "cross-row" : "",
    hover?.columnKey === "total" ? "cross-column" : "",
  ].filter(Boolean).join(" ");
  const yearKey = String(year);
  const label = `${symbol} ${yearKey} ${Number.isFinite(value) ? formatPct(value) : t.tables.noData}`;

  const revealTooltip = (event) => {
    if (row) {
      setTooltip({ x: event.clientX, y: event.clientY, symbol, monthKey: yearKey, year: yearKey, row, value, period: "year" });
    }
  };

  const activate = () => {
    if (row) {
      setTooltip(null);
      onSelect({ symbol, monthKey: yearKey, year: yearKey, row, value, period: "year" });
    }
  };

  return (
    <td
      className={classNames}
      tabIndex={row ? 0 : -1}
      role={row ? "button" : undefined}
      aria-label={label}
      onMouseEnter={(event) => {
        setHover({ rowKey, columnKey: "total" });
        revealTooltip(event);
      }}
      onMouseMove={revealTooltip}
      onMouseLeave={() => {
        setHover(null);
        setTooltip(null);
      }}
      onClick={activate}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activate();
        }
      }}
    >
      {Number.isFinite(value) ? formatPct(value, 0) : ""}
    </td>
  );
}

export function LatestStrip({ dataset, onOpenAsset, t }) {
  return (
    <div className="latest-strip" aria-label={t.latest.aria}>
      {ASSETS.map((asset) => {
        const meta = dataset.assets[asset.symbol];
        const row = meta.rows[meta.rows.length - 1];
        const spot = meta.spot;
        const spotPrice = Number.isFinite(Number(spot?.price)) ? Number(spot.price) : row.close;
        const note = [
          row.monthKey,
          row.isClosed ? null : t.latest.inMonth,
        ].filter(Boolean).join(t.separator);
        return (
          <button type="button" key={asset.symbol} onClick={() => onOpenAsset(asset.symbol)}>
            <span className={`ticker ${asset.accent}`}>{asset.symbol}</span>
            <span className="latest-price"><span className="spot-prefix">{t.latest.spot}</span> {formatPrice(spotPrice, meta.quote)}</span>
            <span className={`latest-return ${row.pct >= 0 ? "positive" : "negative"}`}>{formatPct(row.pct, 2)}</span>
            <small>{note}</small>
          </button>
        );
      })}
    </div>
  );
}

export function AssetSpotSummary({ dataset, symbol, t }) {
  const meta = dataset.assets[symbol];
  if (!meta) return null;
  const asset = ASSETS.find((item) => item.symbol === symbol);
  const row = meta.rows[meta.rows.length - 1];
  const spot = meta.spot;
  const spotPrice = Number.isFinite(Number(spot?.price)) ? Number(spot.price) : row.close;
  const note = [
    row.monthKey,
    row.isClosed ? null : t.latest.inMonth,
  ].filter(Boolean).join(t.separator);

  return (
    <div className="asset-spot-summary" aria-label={`${symbol} ${t.latest.spot}`}>
      <span className={`ticker ${asset?.accent || ""}`}>{symbol}</span>
      <span className="latest-price"><span className="spot-prefix">{t.latest.spot}</span> {formatPrice(spotPrice, meta.quote)}</span>
      <span className={`latest-return ${row.pct >= 0 ? "positive" : "negative"}`}>{formatPct(row.pct, 2)}</span>
      <small>{note}</small>
    </div>
  );
}

export function CryptoInsight({ view, metric, range, asset, dataset, rotationRows, selected, t }) {
  const metricLabel = optionLabel(t.options.metrics, metric);
  const viewLabel = optionLabel(t.options.views, view);
  const rangeLabel = view === "rotation" ? optionLabel(t.options.ranges, range) : null;
  let title = "";
  let body = "";

  if (selected?.row) {
    const quote = dataset.assets[selected.symbol]?.quote || "USD";
    title = t.insight.selectedTitle(selected.symbol, selected.monthKey);
    body = t.insight.selectedBody(
      formatPct(selected.value, 2),
      formatPrice(selected.row.high, quote),
      formatPrice(selected.row.low, quote),
      formatPct(selected.row.extremeMovePct, 2),
    );
  } else if (view === "rotation") {
    const latest = rotationRows[0];
    title = t.insight.rotationTitle;
    body = t.insight.rotationBody(
      latest?.leader,
      latest?.ranking?.map((item, index) => `${index + 1}.${item.symbol}`).join("  "),
    );
  } else {
    const rows = dataset.assets[asset]?.rows || [];
    const latest = rows.at(-1);
    title = t.insight.cycleTitle(asset);
    body = t.insight.cycleBody(
      asset,
      formatPct(latest?.pct, 2),
      formatPct(latest?.extremeMovePct, 2),
    );
  }

  return (
    <section className="insight-card" aria-label={t.insight.label}>
      <div>
        <small>{t.insight.label}</small>
        <strong>{title}</strong>
        <p>{body}</p>
      </div>
      <div className="insight-meta">
        <span>{viewLabel}</span>
        <span>{metricLabel}</span>
        {rangeLabel ? <span>{rangeLabel}</span> : null}
        <small>{t.insight.shareHint}</small>
        <small>{t.insight.mobileHint}</small>
      </div>
    </section>
  );
}

export function MobilePinnedDetail({ selected, dataset, metric, onClear, t }) {
  if (!selected?.row) return null;
  const quote = dataset.assets[selected.symbol]?.quote || "USD";
  const extreme = extremeMoveMeta(selected.row, t);
  const extremeCaption = [extreme.label, extreme.order].filter(Boolean).join(t.separator);
  const isAnnual = selected.period === "year";
  const selectedLabel = isAnnual ? selected.year || selected.monthKey : selected.monthKey;
  return (
    <aside className="mobile-detail-dock" aria-live="polite">
      <button type="button" className="dock-close" onClick={onClear} aria-label={t.detail.closePinned}>脳</button>
      <div>
        <small>{isAnnual ? t.detail.selectedYear : t.detail.selectedMonth}</small>
        <strong>{selected.symbol}{t.separator}{selectedLabel}</strong>
      </div>
      <div>
        <small>{isAnnual ? (metric === "absolute" ? t.detail.annualReturn : t.detail.relativeBtc) : metric === "absolute" ? t.detail.monthlyReturn : t.detail.relativeBtc}</small>
        <strong className={selected.value >= 0 ? "positive" : "negative"}>{formatPct(selected.value, 2)}</strong>
      </div>
      <div>
        <small>{t.detail.high} / {t.detail.low}</small>
        <strong>{formatPrice(selected.row.high, quote)} / {formatPrice(selected.row.low, quote)}</strong>
      </div>
      <div>
        <small>{extremeCaption}</small>
        <strong className={extreme.className}>{formatPct(selected.row.extremeMovePct, 2)}</strong>
      </div>
    </aside>
  );
}

export function RotationTable({ rows, metric, hover, setHover, setTooltip, onSelect, t }) {
  return (
    <div className="table-shell rotation-shell">
      <table className="data-table rotation-table">
        <caption className="sr-only">{t.tables.rotationCaption}</caption>
        <thead>
          <tr>
            <th className="month-column">{t.tables.month}</th>
            {ASSETS.map((asset) => <th key={asset.symbol} className={hover?.columnKey === asset.symbol ? "cross-column" : ""}>{asset.symbol}</th>)}
            <th>{t.tables.leader}</th>
            <th>{t.tables.cycleBackground}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item, rowIndex) => (
            <tr key={item.monthKey} className={rowIndex > 0 && rows[rowIndex - 1].year !== item.year ? "year-break" : ""}>
              <th scope="row" className={hover?.rowKey === item.monthKey ? "cross-row" : ""}>{item.monthKey}</th>
              {ASSETS.map((asset) => {
                const cell = item.cells[asset.symbol];
                return (
                  <HeatCell
                    key={asset.symbol}
                    symbol={asset.symbol}
                    monthKey={item.monthKey}
                    row={cell.row}
                    value={cell.value}
                    rowKey={item.monthKey}
                    columnKey={asset.symbol}
                    hover={hover}
                    setHover={setHover}
                    setTooltip={setTooltip}
                    onSelect={(selected) => onSelect({ ...selected, ranking: item.ranking })}
                    t={t}
                  />
                );
              })}
              <td className={`leader-cell ${item.leader ? `asset-${item.leader.toLowerCase()}` : ""}`}>{item.leader || "N/A"}</td>
              <td className={`cycle-cell ${item.cycle.className}`}>{cycleLabel(item.cycle, t)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="table-note">
        {metric === "absolute" ? t.tables.absoluteNote : t.tables.relativeNote}
      </div>
    </div>
  );
}

export function CycleTable({ years, stats, asset, currentMonthKey, hover, setHover, setTooltip, onSelect, t }) {
  return (
    <div className="table-shell cycle-shell">
      <table className="data-table cycle-table">
        <caption className="sr-only">{t.tables.cycleCaption(asset)}</caption>
        <thead>
          <tr>
            <th>{t.tables.year}</th>
            {t.months.map((month, index) => <th key={month} className={hover?.columnKey === index ? "cross-column" : ""}>{month}</th>)}
            <th className="gap-column" aria-hidden="true"></th>
            <th className={hover?.columnKey === "total" ? "cross-column" : ""}>{t.tables.total}</th>
            <th>{t.tables.cycle}</th>
          </tr>
        </thead>
        <tbody>
          {years.map((year, index) => (
            <Fragment key={year.year}>
              <tr>
                <th
                  scope="row"
                  className={hover?.rowKey === String(year.year) ? "cross-row" : ""}
                  style={{ backgroundColor: yearBackground(index, years.length) }}
                >
                  {year.year}
                </th>
                {year.months.map((month, monthIndex) => (
                  <HeatCell
                    key={month.monthKey}
                    symbol={asset}
                    monthKey={month.monthKey}
                    row={month.row}
                    value={month.value}
                    rowKey={String(year.year)}
                    columnKey={monthIndex}
                    hover={hover}
                    setHover={setHover}
                    setTooltip={setTooltip}
                    onSelect={onSelect}
                    showNA={month.monthKey < currentMonthKey}
                    t={t}
                  />
                ))}
                <td className="gap-column"></td>
                <TotalCell
                  symbol={asset}
                  year={year.year}
                  row={year.totalRow}
                  value={year.totalValue}
                  rowKey={String(year.year)}
                  hover={hover}
                  setHover={setHover}
                  setTooltip={setTooltip}
                  onSelect={onSelect}
                  t={t}
                />
                <td className={`cycle-cell ${year.cycle.className}`}>{cycleLabel(year.cycle, t)}</td>
              </tr>
              {isCycleGroupStartYear(year.year) && index < years.length - 1 ? (
                <tr className="cycle-gap" aria-hidden="true"><td colSpan="16"></td></tr>
              ) : null}
            </Fragment>
          ))}
          <tr className="stats-divider" aria-hidden="true"><td colSpan="16"></td></tr>
          <tr className="stats-row">
            <th scope="row">{t.tables.median}</th>
            {stats.median.map((value, index) => <td key={index} className={returnClass(value)}>{Number.isFinite(value) ? formatPct(value, 0) : ""}</td>)}
            <td className="gap-column"></td><td></td><td></td>
          </tr>
          <tr className="stats-row">
            <th scope="row">{t.tables.average}</th>
            {stats.average.map((value, index) => <td key={index} className={returnClass(value)}>{Number.isFinite(value) ? formatPct(value, 0) : ""}</td>)}
            <td className="gap-column"></td><td></td><td></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function DetailBand({ selected, dataset, metric, t }) {
  if (!selected) {
    return (
      <aside className="detail-band detail-empty" aria-live="polite">
        <strong>{t.detail.title}</strong>
        <span>{t.detail.empty}</span>
      </aside>
    );
  }
  const meta = dataset.assets[selected.symbol];
  const extreme = extremeMoveMeta(selected.row, t);
  const extremeCaption = [extreme.label, extreme.order].filter(Boolean).join(t.separator);
  const isAnnual = selected.period === "year";
  const selectedLabel = isAnnual ? selected.year || selected.monthKey : selected.monthKey;
  return (
    <aside className="detail-band" aria-live="polite">
      <div>
        <small>{isAnnual ? t.detail.selectedYear : t.detail.selectedMonth}</small>
        <strong>{selectedLabel}{t.separator}{selected.symbol}</strong>
      </div>
      <div>
        <small>{isAnnual ? (metric === "absolute" ? t.detail.annualReturn : t.detail.relativeBtc) : metric === "absolute" ? t.detail.monthlyReturn : t.detail.relativeBtc}</small>
        <strong className={selected.value >= 0 ? "positive" : "negative"}>{formatPct(selected.value, 2)}</strong>
      </div>
      <div>
        <small>{t.detail.open}</small>
        <strong>{formatPrice(selected.row.open, meta.quote)}</strong>
      </div>
      <div>
        <small>{selected.row.isClosed ? t.detail.close : t.detail.currentPrice}</small>
        <strong>{formatPrice(selected.row.close, meta.quote)}</strong>
      </div>
      <div>
        <small>{t.detail.high}</small>
        <strong>{formatPrice(selected.row.high, meta.quote)}</strong>
      </div>
      <div>
        <small>{t.detail.low}</small>
        <strong>{formatPrice(selected.row.low, meta.quote)}</strong>
      </div>
      <div>
        <small>{extremeCaption}</small>
        <strong className={extreme.className}>{formatPct(selected.row.extremeMovePct, 2)}</strong>
      </div>
      <div>
        <small>{t.detail.status}</small>
        <strong>{selected.row.isClosed ? t.detail.closed : t.detail.live}</strong>
      </div>
      <div className="detail-source">
        <small>{t.detail.source}</small>
        <strong>{meta.sourceLabel}</strong>
      </div>
      {selected.ranking?.length ? (
        <div className="ranking-line">
          <small>{t.detail.ranking}</small>
          <strong>{selected.ranking.map((item, index) => `${index + 1}.${item.symbol}`).join("  ")}</strong>
        </div>
      ) : null}
    </aside>
  );
}

export function Tooltip({ value, dataset, t }) {
  if (!value?.row) return null;
  const quote = dataset.assets[value.symbol]?.quote || "USD";
  const extreme = extremeMoveMeta(value.row, t);
  const extremeCaption = [extreme.label, extreme.order].filter(Boolean).join(t.separator);
  const isAnnual = value.period === "year";
  const valueLabel = isAnnual ? value.year || value.monthKey : value.monthKey;
  return (
    <div
      className="cell-tooltip"
      style={{
        left: Math.max(8, Math.min(value.x + 14, window.innerWidth - 284)),
        top: Math.max(8, Math.min(value.y + 14, window.innerHeight - 190)),
      }}
    >
      <strong>{value.symbol}{t.separator}{valueLabel}</strong>
      <span>{isAnnual ? t.tooltip.annualReturn : t.tooltip.return} {formatPct(value.value, 2)}</span>
      <span>{t.tooltip.open} {formatPrice(value.row.open, quote)} / {value.row.isClosed ? t.tooltip.close : t.tooltip.currentPrice} {formatPrice(value.row.close, quote)}</span>
      <span>{t.tooltip.high} {formatPrice(value.row.high, quote)} / {t.tooltip.low} {formatPrice(value.row.low, quote)}</span>
      <span className={`tooltip-extreme ${extreme.className}`}>{extremeCaption} {formatPct(value.row.extremeMovePct, 2)}</span>
      <small>{value.row.isClosed ? t.tooltip.closed : t.tooltip.live}</small>
    </div>
  );
}

export function Legend({ t }) {
  const stops = [
    ["鈮?-30%", -35], ["-20%", -20], ["-10%", -10], ["0%", 0], ["+10%", 10], ["+20%", 20], ["鈮?+40%", 40],
  ];
  return (
    <div className="legend" aria-label={t.legend.aria}>
      <span>{t.legend.down}</span>
      {stops.map(([label, value]) => <span key={label} className={returnClass(value)}>{label}</span>)}
      <span>{t.legend.up}</span>
      <span className="halving-cell">{t.legend.halving}</span>
    </div>
  );
}
