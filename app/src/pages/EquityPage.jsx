import { Fragment, useEffect, useMemo, useState } from "react";
import { formatPct, returnClass } from "../data.js";
import {
  EQUITY_CHART_LIVE_DATA,
  EQUITY_SUMMARY_LIVE_DATA,
} from "../shared/data/liveDataDefinitions.js";
import { useDeferredActivation } from "../shared/data/useDeferredActivation.js";
import { replaceHashState } from "../shared/routing/routeViewState.js";
import { useLiveData } from "../useLiveData.js";
import { PageNav } from "../shared/routing/PageNav.jsx";
import { equityCopy } from "../shared/i18n/usEquity.js";
import { CacheStatus } from "../shared/components/CacheStatus.jsx";
import { DataFreshnessSummary, DataTrustFooter, buildFreshnessItem } from "../shared/components/DataTrust.jsx";
import { DataState } from "../shared/components/DataState.jsx";
import { LanguageToggle } from "../shared/components/LanguageToggle.jsx";
import {
  formatNumber,
  formatSignedNumber,
  formatCompactPrice,
  formatBp,
  latestMacro,
  macroClass,
} from "../shared/formatting/metrics.js";
import {
  utcDateFromKey,
  dateKeyFromUtc,
  addUtcDays,
  weekDaysFor,
  monthKeyFromDateKey,
  monthGrid,
  shiftMonth,
  monthTitle,
  dayLabel,
} from "../features/macro/macroCalendarModel.js";
import { useAutoLocalDateKey } from "../features/macro/useAutoLocalDateKey.js";
import {
  EQUITY_ASSET_KEYS,
  NO_RIGHT_METRIC_ID,
  USD_CNY_METRIC_ID,
  METRIC_CHART_DEFAULTS,
  METRIC_CHART_SIZE,
  metricLabel,
  metricOptionsByCategory,
  metricWindowEnd,
  metricWindowDomain,
  metricSeriesForWindow,
  transformMetricPoints,
  metricAxisDomain,
  metricChartY,
  metricChartX,
  plottedMetricPoints,
  metricLinePath,
  metricSparseDots,
  metricTicks,
  metricXTicks,
  compactMetricAxisTitle,
  nearestMetricPoint,
  metricDateLabel,
  formatMetricChartValue,
  equityAssetLabel,
  equityEventLabel,
  equityEventNote,
  equityDaysByDate,
  latestEquityDate,
  formatEquityPrice,
  formatEquityMacroValue,
  formatEquityMacroChange,
  equityMacroLabel,
  equityMacroMove,
  metricPointAtOrBeforeDate,
  equityMoveClass,
  equityMarketPrice,
  equityOpenMove,
  equityDirectionSymbol,
  equityDirectionClass,
  equityFastMetric,
  formatEquityFastMetricValue,
  formatEquityFastMetricNote,
} from "../features/us-equity/equityModel.js";

export function MetricSelect({ label, value, onChange, groups, language, emptyOptionLabel = null, emptyOptionValue = "" }) {
  return (
    <label className="metric-select">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {emptyOptionLabel ? <option value={emptyOptionValue}>{emptyOptionLabel}</option> : null}
        {groups.map((group) => (
          <optgroup label={group.label} key={group.category}>
            {group.items.map((metric) => (
              <option value={metric.id} key={metric.id}>{metricLabel(metric, language)}</option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

export function EquityMarketSummary({ dataset, t }) {
  const copy = equityCopy(t);
  const language = t.htmlLang === "zh-CN" ? "zh" : "en";
  const latest = dataset.latest || {};
  const cards = EQUITY_ASSET_KEYS.map((symbol) => {
    const item = latest.assets?.[symbol];
    return {
      key: symbol,
      label: equityAssetLabel(dataset, symbol, t),
      value: formatEquityPrice(item?.price ?? item?.close),
      delta: formatPct(item?.pct, 2),
      className: equityMoveClass(item?.pct),
      note: item?.date || latest.date || "N/A",
    };
  });
  const fastCards = [
    ["BTC_MARKET_CAP", copy.btcMarketCap],
    ["CRYPTO_MARKET_CAP", copy.cryptoMarketCap],
    ["GOLD_PRICE_PROXY", copy.goldProxy],
  ].map(([metricId, label]) => {
    const metric = equityFastMetric(dataset, metricId);
    return {
      key: metricId,
      label,
      value: formatEquityFastMetricValue(metric),
      delta: Number.isFinite(Number(metric?.changePct)) ? formatPct(metric.changePct, 2) : "N/A",
      className: equityMoveClass(metric?.changePct),
      note: formatEquityFastMetricNote(metric, copy, language),
    };
  });
  const tenYear = latest.macro?.DGS10;
  const japanTenYear = latest.macro?.JGB10Y;
  const vix = latest.macro?.VIXCLS;
  return (
    <div className="latest-strip equity-strip" aria-label={copy.latest}>
      {cards.map((card) => (
        <div className="equity-summary-card" key={card.key}>
          <span className="ticker">{card.label}</span>
          <span className="latest-price">{card.value}</span>
          <span className={`latest-return ${card.className}`}>{card.delta}</span>
          <small>{card.note}</small>
        </div>
      ))}
      <div className="equity-summary-card equity-macro-summary">
        <span className="ticker">{copy.macro}</span>
        <div className="equity-summary-lines">
          <span><b>{copy.tenYear}</b><strong>{formatEquityMacroValue(tenYear?.value, "percent")}</strong><em className={macroClass(tenYear?.changeBp)}>{formatEquityMacroChange("DGS10", tenYear)}</em></span>
          <span><b>{copy.japanTenYearCompact}</b><strong>{formatEquityMacroValue(japanTenYear?.value, "percent")}</strong><em className={macroClass(japanTenYear?.changeBp)}>{formatEquityMacroChange("JGB10Y", japanTenYear)}</em></span>
          <span><b>{copy.vix}</b><strong>{formatEquityMacroValue(vix?.value, "index")}</strong><em className={macroClass(vix?.change)}>{formatEquityMacroChange("VIXCLS", vix)}</em></span>
        </div>
        <small className="equity-macro-dates">
          <span>US10Y {tenYear?.date || "N/A"}</span>
          <span>JP10Y {japanTenYear?.date || "N/A"}</span>
          <span>VIX {vix?.date || "N/A"}</span>
        </small>
      </div>
      {fastCards.map((card) => (
        <div className="equity-summary-card equity-fast-summary" key={card.key}>
          <span className="ticker">{card.label}</span>
          <span className="latest-price">{card.value}</span>
          <span className={`latest-return ${card.className}`}>{card.delta}</span>
          <small>{card.note}</small>
        </div>
      ))}
    </div>
  );
}

export function MetricComparePanel({ chartDataset, language, t }) {
  const copy = equityCopy(t);
  const metrics = chartDataset?.metrics || {};
  const metricIds = chartDataset?.metricOrder || Object.keys(metrics);
  const defaultLeft = metrics[METRIC_CHART_DEFAULTS.left] ? METRIC_CHART_DEFAULTS.left : metricIds[0];
  const defaultRight = metrics[METRIC_CHART_DEFAULTS.right] ? METRIC_CHART_DEFAULTS.right : NO_RIGHT_METRIC_ID;
  const [leftMetricId, setLeftMetricId] = useState(defaultLeft || "");
  const [rightMetricId, setRightMetricId] = useState(defaultRight || "");
  const [windowValue, setWindowValue] = useState(METRIC_CHART_DEFAULTS.window);
  const [transform, setTransform] = useState(METRIC_CHART_DEFAULTS.transform);
  const [zoom, setZoom] = useState(METRIC_CHART_DEFAULTS.zoom);
  const [hover, setHover] = useState(null);

  useEffect(() => {
    if (!metricIds.length) return;
    setLeftMetricId((current) => metrics[current] ? current : defaultLeft || metricIds[0]);
    setRightMetricId((current) => current === NO_RIGHT_METRIC_ID || metrics[current] ? current : defaultRight || NO_RIGHT_METRIC_ID);
  }, [defaultLeft, defaultRight, metricIds, metrics]);

  const groups = useMemo(() => metricOptionsByCategory(chartDataset, language), [chartDataset, language]);
  const windows = chartDataset?.windows?.length ? chartDataset.windows : [
    { value: "1d", label: "1D" },
    { value: "7d", label: "7D" },
    { value: "1m", label: "1M" },
    { value: "3m", label: "3M" },
  ];
  const transforms = chartDataset?.transforms?.length ? chartDataset.transforms : [];
  const leftMetric = metrics[leftMetricId];
  const rightMetric = metrics[rightMetricId];
  const hasRightMetric = rightMetricId !== NO_RIGHT_METRIC_ID && Boolean(rightMetric);
  const selectedMetricIds = useMemo(() => [leftMetricId, hasRightMetric ? rightMetricId : null].filter(Boolean), [leftMetricId, rightMetricId, hasRightMetric]);
  const windowEndMs = useMemo(() => metricWindowEnd(chartDataset, selectedMetricIds), [chartDataset, selectedMetricIds]);
  const xDomain = useMemo(() => metricWindowDomain(chartDataset, windowValue, windowEndMs), [chartDataset, windowValue, windowEndMs]);
  const leftRaw = useMemo(() => metricSeriesForWindow(chartDataset, leftMetricId, windowValue, windowEndMs), [chartDataset, leftMetricId, windowValue, windowEndMs]);
  const rightRaw = useMemo(() => hasRightMetric ? metricSeriesForWindow(chartDataset, rightMetricId, windowValue, windowEndMs) : [], [chartDataset, rightMetricId, windowValue, windowEndMs, hasRightMetric]);
  const leftSeries = useMemo(() => transformMetricPoints(leftRaw, transform), [leftRaw, transform]);
  const rightSeries = useMemo(() => transformMetricPoints(rightRaw, transform), [rightRaw, transform]);
  const leftDomain = useMemo(() => metricAxisDomain(leftSeries, zoom), [leftSeries, zoom]);
  const rightDomain = useMemo(() => metricAxisDomain(rightSeries, zoom), [rightSeries, zoom]);
  const leftPoints = useMemo(() => plottedMetricPoints(leftSeries, xDomain, leftDomain), [leftSeries, xDomain, leftDomain]);
  const rightPoints = useMemo(() => plottedMetricPoints(rightSeries, xDomain, rightDomain), [rightSeries, xDomain, rightDomain]);
  const leftPath = useMemo(() => metricLinePath(leftPoints, leftMetric), [leftPoints, leftMetric]);
  const rightPath = useMemo(() => metricLinePath(rightPoints, rightMetric), [rightPoints, rightMetric]);
  const leftDots = useMemo(() => metricSparseDots(leftPoints), [leftPoints]);
  const rightDots = useMemo(() => metricSparseDots(rightPoints), [rightPoints]);
  const xTicks = useMemo(() => metricXTicks(xDomain, windowValue), [xDomain, windowValue]);
  const leftTicks = useMemo(() => metricTicks(leftDomain, 5), [leftDomain]);
  const rightTicks = useMemo(() => metricTicks(rightDomain, 5), [rightDomain]);
  const hasDrawableLine = leftPoints.length >= 2 || rightPoints.length >= 2;

  if (!chartDataset) {
    return (
      <section className="visualization metric-compare-section">
        <div className="macro-section-heading">
          <div>
            <p>{copy.compareKicker}</p>
            <h2>{copy.compareTitle}</h2>
          </div>
        </div>
        <div className="metric-chart-empty">{copy.chartLoading}</div>
      </section>
    );
  }

  if (!metricIds.length) {
    return (
      <section className="visualization metric-compare-section">
        <div className="macro-section-heading">
          <div>
            <p>{copy.compareKicker}</p>
            <h2>{copy.compareTitle}</h2>
          </div>
        </div>
        <div className="metric-chart-empty">{copy.chartUnavailable}</div>
      </section>
    );
  }

  const handlePointerMove = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const svgX = ((event.clientX - rect.left) / rect.width) * METRIC_CHART_SIZE.width;
    const clampedX = Math.max(METRIC_CHART_SIZE.left, Math.min(METRIC_CHART_SIZE.width - METRIC_CHART_SIZE.right, svgX));
    const targetMs = xDomain[0] + ((clampedX - METRIC_CHART_SIZE.left) / (METRIC_CHART_SIZE.width - METRIC_CHART_SIZE.left - METRIC_CHART_SIZE.right)) * (xDomain[1] - xDomain[0]);
    setHover({
      x: clampedX,
      left: nearestMetricPoint(leftPoints, targetMs),
      right: hasRightMetric ? nearestMetricPoint(rightPoints, targetMs) : null,
    });
  };

  const resetChart = () => {
    setLeftMetricId(defaultLeft || metricIds[0]);
    setRightMetricId(defaultRight || NO_RIGHT_METRIC_ID);
    setWindowValue(METRIC_CHART_DEFAULTS.window);
    setTransform(METRIC_CHART_DEFAULTS.transform);
    setZoom(METRIC_CHART_DEFAULTS.zoom);
    setHover(null);
  };

  const leftLatest = leftRaw.at(-1);
  const rightLatest = rightRaw.at(-1);

  return (
    <section className="visualization metric-compare-section" aria-label={copy.compareTitle}>
      <div className="macro-section-heading metric-compare-heading">
        <div>
          <p>{copy.compareKicker}</p>
          <h2>{copy.compareTitle}</h2>
        </div>
        <span>{copy.compareSubtitle}</span>
      </div>

      <div className="metric-chart-controls" aria-label={copy.compareTitle}>
        <MetricSelect label={copy.leftAxis} value={leftMetricId} onChange={setLeftMetricId} groups={groups} language={language} />
        <MetricSelect
          label={copy.rightAxis}
          value={rightMetricId}
          onChange={setRightMetricId}
          groups={groups}
          language={language}
          emptyOptionLabel={copy.noRightAxis}
          emptyOptionValue={NO_RIGHT_METRIC_ID}
        />
        <div className="metric-control-group">
          <span>{copy.xWindow}</span>
          <div className="segmented segmented-compact">
            {windows.map((item) => (
              <button type="button" className={windowValue === item.value ? "is-active" : ""} onClick={() => setWindowValue(item.value)} key={item.value}>
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div className="metric-control-group">
          <span>{copy.transform}</span>
          <div className="segmented segmented-compact">
            {transforms.map((item) => (
              <button type="button" className={transform === item.value ? "is-active" : ""} onClick={() => setTransform(item.value)} key={item.value}>
                {language === "en" ? item.labelEn : item.labelZh}
              </button>
            ))}
          </div>
        </div>
        <label className="metric-zoom-control">
          <span>{copy.yZoom} {formatNumber(zoom, 2)}x</span>
          <input type="range" min="0.75" max="2.5" step="0.25" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
        </label>
        <button type="button" className="metric-reset-button" onClick={resetChart}>{copy.reset}</button>
      </div>

      <div className="metric-chart-frame">
        <svg
          className="metric-chart-svg"
          viewBox={`0 0 ${METRIC_CHART_SIZE.width} ${METRIC_CHART_SIZE.height}`}
          role="img"
          aria-label={`${metricLabel(leftMetric, language)}${hasRightMetric ? ` / ${metricLabel(rightMetric, language)}` : ""}`}
          onMouseMove={handlePointerMove}
          onMouseLeave={() => setHover(null)}
          focusable="false"
        >
          <rect
            className="metric-chart-bg"
            x={METRIC_CHART_SIZE.left}
            y={METRIC_CHART_SIZE.top}
            width={METRIC_CHART_SIZE.width - METRIC_CHART_SIZE.left - METRIC_CHART_SIZE.right}
            height={METRIC_CHART_SIZE.height - METRIC_CHART_SIZE.top - METRIC_CHART_SIZE.bottom}
          />
          {leftTicks.map((tick) => {
            const y = metricChartY(tick, leftDomain);
            return (
              <Fragment key={`left-${tick}`}>
                <line className="metric-chart-grid" x1={METRIC_CHART_SIZE.left} x2={METRIC_CHART_SIZE.width - METRIC_CHART_SIZE.right} y1={y} y2={y} />
                <text className="metric-axis-label metric-axis-left" x={METRIC_CHART_SIZE.left - 10} y={y + 4}>{formatMetricChartValue(tick, leftMetric, transform, language)}</text>
              </Fragment>
            );
          })}
          {hasRightMetric ? rightTicks.map((tick) => {
            const y = metricChartY(tick, rightDomain);
            return (
              <text className="metric-axis-label metric-axis-right" x={METRIC_CHART_SIZE.width - METRIC_CHART_SIZE.right + 10} y={y + 4} key={`right-${tick}`}>
                {formatMetricChartValue(tick, rightMetric, transform, language)}
              </text>
            );
          }) : null}
          <text className="metric-axis-title metric-axis-title-left" x={METRIC_CHART_SIZE.left} y={METRIC_CHART_SIZE.top - 8}>
            {copy.leftAxis}: {compactMetricAxisTitle(leftMetric, language)}
          </text>
          {hasRightMetric ? (
            <text className="metric-axis-title metric-axis-title-right" x={METRIC_CHART_SIZE.width - METRIC_CHART_SIZE.right} y={METRIC_CHART_SIZE.top - 8}>
              {copy.rightAxis}: {compactMetricAxisTitle(rightMetric, language)}
            </text>
          ) : null}
          {xTicks.map((tick) => {
            const x = metricChartX(tick, xDomain);
            return (
              <Fragment key={`x-${tick}`}>
                <line className="metric-chart-grid metric-chart-grid-vertical" x1={x} x2={x} y1={METRIC_CHART_SIZE.top} y2={METRIC_CHART_SIZE.height - METRIC_CHART_SIZE.bottom} />
                <text className="metric-axis-label metric-axis-bottom" x={x} y={METRIC_CHART_SIZE.height - 14}>{metricDateLabel(tick, language, xDomain[1] - xDomain[0] > 172800000)}</text>
              </Fragment>
            );
          })}
          {hover ? <line className="metric-hover-line" x1={hover.x} x2={hover.x} y1={METRIC_CHART_SIZE.top} y2={METRIC_CHART_SIZE.height - METRIC_CHART_SIZE.bottom} /> : null}
          {leftPoints.length >= 2 ? <path className="metric-line metric-line-left" d={leftPath} /> : null}
          {hasRightMetric && rightPoints.length >= 2 ? <path className="metric-line metric-line-right" d={rightPath} /> : null}
          {leftDots.map((point) => (
            <circle className="metric-sample-dot metric-sample-left" cx={point.x} cy={point.y} r="2.6" key={`left-dot-${point.t}`} />
          ))}
          {hasRightMetric ? rightDots.map((point) => (
            <circle className="metric-sample-dot metric-sample-right" cx={point.x} cy={point.y} r="2.6" key={`right-dot-${point.t}`} />
          )) : null}
          {leftPoints.length ? <circle className="metric-end-dot metric-end-left" cx={leftPoints.at(-1).x} cy={leftPoints.at(-1).y} r="4" /> : null}
          {hasRightMetric && rightPoints.length ? <circle className="metric-end-dot metric-end-right" cx={rightPoints.at(-1).x} cy={rightPoints.at(-1).y} r="4" /> : null}
        </svg>
        {hover ? (
          <div className="metric-tooltip" style={{ left: `${(hover.x / METRIC_CHART_SIZE.width) * 100}%` }}>
            {hover.left ? (
              <span>
                <b className="metric-left-swatch">{metricLabel(leftMetric, language)}</b>
                <strong>{formatMetricChartValue(hover.left.value, leftMetric, transform, language)}</strong>
                <em>{formatMetricChartValue(hover.left.raw, leftMetric, "raw", language)} / {metricDateLabel(hover.left.ms, language)}</em>
              </span>
            ) : null}
            {hover.right ? (
              <span>
                <b className="metric-right-swatch">{metricLabel(rightMetric, language)}</b>
                <strong>{formatMetricChartValue(hover.right.value, rightMetric, transform, language)}</strong>
                <em>{formatMetricChartValue(hover.right.raw, rightMetric, "raw", language)} / {metricDateLabel(hover.right.ms, language)}</em>
              </span>
            ) : null}
          </div>
        ) : null}
        {!hasDrawableLine ? <div className="metric-chart-empty is-overlay">{copy.chartInsufficient}</div> : null}
      </div>

      <div className="metric-chart-meta">
        <div>
          <span className="metric-left-swatch">{copy.leftAxis}</span>
          <strong>{metricLabel(leftMetric, language)}</strong>
          <small>{leftSeries.length} {copy.points} / {copy.latestPoint} {leftLatest ? formatMetricChartValue(leftLatest.raw, leftMetric, "raw", language) : "N/A"}</small>
          <em>{copy.source}: {leftMetric?.source || "N/A"}</em>
        </div>
        {hasRightMetric ? (
          <div>
            <span className="metric-right-swatch">{copy.rightAxis}</span>
            <strong>{metricLabel(rightMetric, language)}</strong>
            <small>{rightSeries.length} {copy.points} / {copy.latestPoint} {rightLatest ? formatMetricChartValue(rightLatest.raw, rightMetric, "raw", language) : "N/A"}</small>
            <em>{copy.source}: {rightMetric?.source || "N/A"}</em>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function EquityMarketWeekCalendar({ dataset, visibleWeekDate, setVisibleWeekDate, t }) {
  const copy = equityCopy(t);
  const language = t.htmlLang === "zh-CN" ? "zh" : "en";
  const byDate = useMemo(() => equityDaysByDate(dataset), [dataset]);
  const days = useMemo(() => weekDaysFor(visibleWeekDate), [visibleWeekDate]);
  const shiftVisibleWeek = (daysToAdd) => {
    setVisibleWeekDate((current) => dateKeyFromUtc(addUtcDays(utcDateFromKey(current), daysToAdd)));
  };
  return (
    <section className="visualization equity-calendar-section" aria-label={copy.weekCalendarTitle}>
      <div className="macro-section-heading">
        <div>
          <p>{copy.currentWeek}</p>
          <h2>{copy.weekCalendarTitle}</h2>
        </div>
        <span>{days[0].dateKey} - {days[6].dateKey}</span>
      </div>
      <div className="macro-week-carousel">
        <button type="button" className="macro-week-nav macro-week-prev" onClick={() => shiftVisibleWeek(-7)} aria-label={copy.previousWeek}>
          <span aria-hidden="true">&lt;</span>
        </button>
        <div className="table-shell macro-week-shell">
          <table className="macro-week-calendar equity-week-calendar">
            <caption className="sr-only">{copy.weekCalendarTitle}</caption>
            <thead>
              <tr>
                {days.map((day) => (
                  <th key={day.dateKey} className={day.isToday ? "is-today" : ""}>
                    <strong>{t.macroCalendar.weekdayNames[day.dayIndex]}</strong>
                    <span>{dayLabel(day.dateKey)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {days.map((day) => {
                  const row = byDate.get(day.dateKey);
                  const hasData = row?.isMarketDay && Object.values(row.assets || {}).some(Boolean);
                  const isClosed = (row && !row.isMarketDay) || (!row && (day.dayIndex === 0 || day.dayIndex === 6));
                  const events = row?.events || [];
                  return (
                    <td key={day.dateKey} className={[hasData || events.length ? "" : "macro-calendar-empty", isClosed ? "is-closed" : "", day.isToday ? "is-today" : ""].filter(Boolean).join(" ")}>
                      {hasData || isClosed || events.length ? (
                        <div className="equity-day-detail">
                          {hasData ? EQUITY_ASSET_KEYS.map((symbol) => {
                            const asset = row.assets?.[symbol];
                            return asset ? (
                              <span className={`equity-day-row equity-direction-row ${equityDirectionClass(asset)}`} key={symbol}>
                                <b>{equityAssetLabel(dataset, symbol, t)}</b>
                                <strong>{equityDirectionSymbol(asset)}</strong>
                              </span>
                            ) : null;
                          }) : null}
                          {hasData ? ["DGS10", "VIXCLS"].map((seriesId) => {
                            const item = row.macro?.[seriesId];
                            const label = seriesId === "DGS10" ? copy.tenYear : copy.vix;
                            return item ? (
                              <span className="equity-day-row equity-macro-row" key={seriesId}>
                                <b>{label}</b>
                                <em>{formatEquityMacroValue(item.value, dataset.macroSeries?.[seriesId]?.unit)}</em>
                                <strong className={macroClass(seriesId === "DGS10" ? item.changeBp : item.change)}>{formatEquityMacroChange(seriesId, item)}</strong>
                              </span>
                            ) : null;
                          }) : null}
                          {!hasData && isClosed ? <span className="equity-market-closed">{copy.marketClosed}</span> : null}
                          {events.map((event) => (
                            <span className="equity-day-row equity-event-row macro-liquidity" key={event.id} title={equityEventNote(event, language)}>
                              <b>{equityEventLabel(event, language)}</b>
                              <strong>{language === "en" ? "Liquidity" : "流动性"}</strong>
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
        <button type="button" className="macro-week-nav macro-week-next" onClick={() => shiftVisibleWeek(7)} aria-label={copy.nextWeek}>
          <span aria-hidden="true">&gt;</span>
        </button>
      </div>
    </section>
  );
}

export function EquityDateDetails({ dateKey, row, dataset, t }) {
  const copy = equityCopy(t);
  const language = t.htmlLang === "zh-CN" ? "zh" : "en";
  const assetItems = EQUITY_ASSET_KEYS
    .map((symbol) => ({ symbol, asset: row?.assets?.[symbol] }))
    .filter((item) => item.asset);
  const macroItems = ["DGS10", "JGB10Y", "VIXCLS"]
    .map((seriesId) => ({ seriesId, item: row?.macro?.[seriesId] }))
    .filter((entry) => entry.item);
  const eventItems = row?.events || [];
  const usdCnyItem = metricPointAtOrBeforeDate(dataset.chartSeries, USD_CNY_METRIC_ID, dateKey);
  const count = assetItems.length + macroItems.length + eventItems.length + (usdCnyItem ? 1 : 0);
  const isClosed = row && !row.isMarketDay;
  return (
    <aside className="macro-date-detail equity-date-detail" aria-live="polite">
      <div className="macro-date-detail-heading">
        <div>
          <small>{t.macroCalendar.selectedDate}</small>
          <strong>{dateKey}</strong>
        </div>
        <span>{count ? `${count} ${copy.priceIndicators}` : isClosed ? copy.marketClosed : t.macroCalendar.noIndicators}</span>
      </div>
      {count ? (
        <div className="macro-date-detail-list">
          {assetItems.map(({ symbol, asset }) => {
            const current = equityMarketPrice(asset);
            const move = equityOpenMove(asset);
            const className = equityMoveClass(move);
            return (
              <div className="macro-date-detail-item equity-date-detail-item" key={`${symbol}-${asset.date || dateKey}`}>
                <span className={`macro-pill equity-pill ${className}`}>{equityAssetLabel(dataset, symbol, t)}</span>
                <strong>{dataset.assets?.[symbol]?.name || symbol}</strong>
                <dl>
                  <div><dt>{copy.open}</dt><dd>{formatEquityPrice(asset.open)}</dd></div>
                  <div><dt>{copy.currentPrice}</dt><dd>{formatEquityPrice(current)}</dd></div>
                  <div><dt>{copy.dayMove}</dt><dd className={className}>{formatPct(asset.pct, 2)}</dd></div>
                  <div><dt>{copy.close}</dt><dd>{formatEquityPrice(asset.close)}</dd></div>
                </dl>
                <small>{asset.date || dateKey} / {dataset.assets?.[symbol]?.sourceLabel || symbol}</small>
              </div>
            );
          })}
          {macroItems.map(({ seriesId, item }) => {
            const label = equityMacroLabel(seriesId, copy);
            const unit = dataset.macroSeries?.[seriesId]?.unit;
            const move = equityMacroMove(seriesId, item);
            const source = dataset.macroSeries?.[seriesId]?.source || "FRED";
            return (
              <div className="macro-date-detail-item equity-date-detail-item" key={`${seriesId}-${item.date || dateKey}`}>
                <span className={`macro-pill ${seriesId === "VIXCLS" ? "macro-volatility" : "macro-rates"}`}>{label}</span>
                <strong>{dataset.macroSeries?.[seriesId]?.label || label}</strong>
                <dl>
                  <div><dt>{t.macroCalendar.previous}</dt><dd>{formatEquityMacroValue(item.previous, unit)}</dd></div>
                  <div><dt>{t.macroCalendar.actual}</dt><dd>{formatEquityMacroValue(item.value, unit)}</dd></div>
                  <div><dt>{t.macroCalendar.change}</dt><dd className={macroClass(move)}>{formatEquityMacroChange(seriesId, item)}</dd></div>
                  <div><dt>{t.macroCalendar.dateMeaning}</dt><dd>{dayLabel(item.date || dateKey)}</dd></div>
                </dl>
                <small>{t.macroCalendar.dailyObservation} / {source}</small>
              </div>
            );
          })}
          {usdCnyItem ? (
            <div className="macro-date-detail-item equity-date-detail-item" key={`${USD_CNY_METRIC_ID}-${usdCnyItem.point.t}`}>
              <span className="macro-pill macro-rates">{copy.usdCny}</span>
              <strong>{metricLabel(usdCnyItem.metric, language)}</strong>
              <dl>
                <div><dt>{t.macroCalendar.previous}</dt><dd>{usdCnyItem.previous ? formatMetricChartValue(usdCnyItem.previous.raw, usdCnyItem.metric, "raw", language) : "N/A"}</dd></div>
                <div><dt>{t.macroCalendar.actual}</dt><dd>{formatMetricChartValue(usdCnyItem.point.raw, usdCnyItem.metric, "raw", language)}</dd></div>
                <div><dt>{t.macroCalendar.change}</dt><dd className={macroClass(usdCnyItem.change)}>{Number.isFinite(Number(usdCnyItem.change)) ? formatSignedNumber(usdCnyItem.change, 4) : "N/A"}</dd></div>
                <div><dt>{t.macroCalendar.observedDate}</dt><dd>{dayLabel(usdCnyItem.point.t)}</dd></div>
              </dl>
              <small>{t.macroCalendar.dailyObservation} / {usdCnyItem.metric.source || "FRED"}</small>
            </div>
          ) : null}
          {eventItems.map((event) => (
            <div className="macro-date-detail-item equity-date-detail-item equity-event-detail" key={event.id}>
              <span className="macro-pill macro-liquidity">{language === "en" ? "Liquidity" : "流动性"}</span>
              <strong>{equityEventLabel(event, language)}</strong>
              <p>{equityEventNote(event, language)}</p>
              <small>{event.date} / {event.source || "Reviewed recurring event"}</small>
            </div>
          ))}
        </div>
      ) : (
        <p>{isClosed ? copy.marketClosed : t.macroCalendar.noIndicators}</p>
      )}
    </aside>
  );
}

export function EquityMarketMonthCalendar({ dataset, visibleMonth, setVisibleMonth, selectedDate, setSelectedDate, language, t }) {
  const copy = equityCopy(t);
  const byDate = useMemo(() => equityDaysByDate(dataset), [dataset]);
  const days = useMemo(() => monthGrid(visibleMonth), [visibleMonth]);
  const selectedRow = byDate.get(selectedDate);
  return (
    <section className="visualization equity-calendar-section" aria-label={copy.monthCalendarTitle}>
      <div className="macro-section-heading">
        <div>
          <p>{copy.currentMonth}</p>
          <h2>{copy.monthCalendarTitle}</h2>
        </div>
        <div className="macro-month-controls">
          <button type="button" onClick={() => setVisibleMonth((month) => shiftMonth(month, -1))}>{copy.previousMonth}</button>
          <strong>{monthTitle(visibleMonth, language)}</strong>
          <button type="button" onClick={() => setVisibleMonth((month) => shiftMonth(month, 1))}>{copy.nextMonth}</button>
        </div>
      </div>
      <div className="macro-month-shell equity-month-shell">
        <div className="macro-month-weekdays">
          {t.macroCalendar.weekdays.map((day) => <span key={day}>{day}</span>)}
        </div>
        <div className="macro-month-grid">
          {days.map((day) => {
            const row = byDate.get(day.dateKey);
            const hasData = row?.isMarketDay && Object.values(row.assets || {}).some(Boolean);
            const isClosed = day.inMonth && row && !row.isMarketDay;
            const events = row?.events || [];
            return (
              <button
                type="button"
                key={day.dateKey}
                onClick={() => setSelectedDate(day.dateKey)}
                className={[
                  "macro-month-day",
                  "equity-month-day",
                  day.inMonth ? "" : "is-muted",
                  day.isToday ? "is-today" : "",
                  selectedDate === day.dateKey ? "is-selected" : "",
                  hasData || events.length ? "has-items" : "",
                ].filter(Boolean).join(" ")}
              >
                <strong>{day.dayOfMonth}</strong>
                <span className="macro-month-items">
                  {hasData ? EQUITY_ASSET_KEYS.map((symbol) => {
                    const asset = row.assets?.[symbol];
                    return asset ? (
                      <small className={`macro-month-tag equity-month-tag ${equityDirectionClass(asset)}`} key={symbol}>
                        <span>{equityAssetLabel(dataset, symbol, t)}</span>
                        <strong className="equity-month-arrow">{equityDirectionSymbol(asset)}</strong>
                      </small>
                    ) : null;
                  }) : null}
                  {hasData ? ["DGS10", "VIXCLS"].map((seriesId) => {
                    const item = row.macro?.[seriesId];
                    const label = seriesId === "DGS10" ? copy.tenYear : copy.vix;
                    const move = seriesId === "DGS10" ? item?.changeBp : item?.change;
                    return item ? (
                      <small className={`macro-month-tag equity-month-tag ${macroClass(move)}`} key={seriesId}>
                        {label} {formatEquityMacroChange(seriesId, item)}
                      </small>
                    ) : null;
                  }) : isClosed ? (
                    <small className="macro-month-tag equity-month-tag equity-market-closed-tag">{copy.marketClosed}</small>
                  ) : null}
                  {events.map((event) => (
                    <small className="macro-month-tag equity-month-tag equity-event-tag macro-liquidity" key={event.id} title={equityEventNote(event, language)}>
                      {equityEventLabel(event, language)}
                    </small>
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <EquityDateDetails dateKey={selectedDate} row={selectedRow} dataset={dataset} t={t} />
    </section>
  );
}

export function EquityCell({
  week,
  columnKey,
  value,
  children,
  hover,
  setHover,
  setTooltip,
  onSelect,
  className = "",
}) {
  const classNames = [
    "heat-cell",
    Number.isFinite(value) ? returnClass(value) : "return-na",
    hover?.rowKey === week.weekKey ? "cross-row" : "",
    hover?.columnKey === columnKey ? "cross-column" : "",
    className,
  ].filter(Boolean).join(" ");
  const revealTooltip = (event) => {
    setTooltip({ x: event.clientX, y: event.clientY, week, columnKey, value });
  };
  return (
    <td
      className={classNames}
      tabIndex={0}
      role="button"
      aria-label={`${week.weekKey} ${columnKey} ${Number.isFinite(value) ? formatPct(value, 2) : "N/A"}`}
      onMouseEnter={(event) => {
        setHover({ rowKey: week.weekKey, columnKey });
        revealTooltip(event);
      }}
      onMouseMove={revealTooltip}
      onMouseLeave={() => {
        setHover(null);
        setTooltip(null);
      }}
      onClick={() => onSelect(week)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(week);
        }
      }}
    >
      {children ?? (Number.isFinite(value) ? formatPct(value, 1) : "N/A")}
    </td>
  );
}

export function EquitySummaryStrip({ dataset, t }) {
  const latest = dataset.weeks.at(-1);
  const tenYear = latestMacro(latest, "DGS10");
  const vix = latestMacro(latest, "VIXCLS");
  const cards = [
    {
      label: t.equity.qqq,
      value: formatCompactPrice(latest.assets.QQQ?.close),
      delta: formatPct(latest.assets.QQQ?.pct, 2),
      className: latest.assets.QQQ?.pct >= 0 ? "positive" : "negative",
      note: latest.assets.QQQ?.tradingEnd,
    },
    {
      label: t.equity.spy,
      value: formatCompactPrice(latest.assets.SPY?.close),
      delta: formatPct(latest.assets.SPY?.pct, 2),
      className: latest.assets.SPY?.pct >= 0 ? "positive" : "negative",
      note: latest.assets.SPY?.tradingEnd,
    },
    {
      label: t.equity.relative,
      value: formatPct(latest.relativePct, 2),
      delta: latest.leader || "N/A",
      className: latest.relativePct >= 0 ? "positive" : "negative",
      note: t.equity.latestWeek,
    },
    {
      label: "10Y / VIX",
      value: `${formatBp(tenYear?.changeBp)} / ${formatSignedNumber(vix?.change, 2)}`,
      delta: `VIX ${formatNumber(vix?.end, 2)}`,
      className: macroClass(vix?.change),
      note: latest.weekKey,
    },
  ];
  return (
    <div className="latest-strip equity-strip" aria-label={t.equity.latestWeek}>
      {cards.map((card) => (
        <div className="equity-summary-card" key={card.label}>
          <span className="ticker">{card.label}</span>
          <span className="latest-price">{card.value}</span>
          <span className={`latest-return ${card.className}`}>{card.delta}</span>
          <small>{card.note}</small>
        </div>
      ))}
    </div>
  );
}

export function EquityTable({ rows, hover, setHover, setTooltip, onSelect, t }) {
  return (
    <div className="table-shell equity-shell">
      <table className="data-table equity-table">
        <caption className="sr-only">{t.equity.tableCaption}</caption>
        <thead>
          <tr>
            <th className="week-column">{t.equity.week}</th>
            <th className={hover?.columnKey === "QQQ" ? "cross-column" : ""}>{t.equity.qqqReturn}</th>
            <th className={hover?.columnKey === "SPY" ? "cross-column" : ""}>{t.equity.spyReturn}</th>
            <th className={hover?.columnKey === "relative" ? "cross-column" : ""}>{t.equity.relativeReturn}</th>
            <th>{t.equity.tenYear}</th>
            <th>{t.equity.vix}</th>
            <th>{t.equity.leader}</th>
            <th>{t.equity.events}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((week) => {
            const tenYear = latestMacro(week, "DGS10");
            const vix = latestMacro(week, "VIXCLS");
            const tradingStart = week.assets.QQQ?.tradingStart || week.assets.SPY?.tradingStart || week.weekStart;
            const tradingEnd = week.assets.QQQ?.tradingEnd || week.assets.SPY?.tradingEnd || week.weekEnd;
            return (
              <tr key={week.weekKey}>
                <th scope="row" className={hover?.rowKey === week.weekKey ? "cross-row" : ""}>
                  <button type="button" onClick={() => onSelect(week)}>
                    <strong>{week.weekKey}</strong>
                    <span>{tradingStart} → {tradingEnd}</span>
                  </button>
                </th>
                <EquityCell week={week} columnKey="QQQ" value={week.assets.QQQ?.pct} hover={hover} setHover={setHover} setTooltip={setTooltip} onSelect={onSelect} />
                <EquityCell week={week} columnKey="SPY" value={week.assets.SPY?.pct} hover={hover} setHover={setHover} setTooltip={setTooltip} onSelect={onSelect} />
                <EquityCell week={week} columnKey="relative" value={week.relativePct} hover={hover} setHover={setHover} setTooltip={setTooltip} onSelect={onSelect} />
                <td className={macroClass(tenYear?.changeBp)}>{formatBp(tenYear?.changeBp)}</td>
                <td className={macroClass(vix?.change)}>{formatNumber(vix?.change, 2)}</td>
                <td className={`leader-cell ${week.leader === "QQQ" ? "asset-eth" : "asset-btc"}`}>{week.leader || "N/A"}</td>
                <td className="event-cell">{week.events?.length ? week.events.length : t.equity.noEvents}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="table-note">{t.equity.method}</div>
    </div>
  );
}

export function EquityDetailBand({ selected, dataset, t }) {
  if (!selected) {
    return (
      <aside className="detail-band detail-empty equity-detail-empty" aria-live="polite">
        <strong>{t.equity.emptyDetailTitle}</strong>
        <span>{t.equity.emptyDetailBody}</span>
      </aside>
    );
  }
  const tenYear = latestMacro(selected, "DGS10");
  const vix = latestMacro(selected, "VIXCLS");
  return (
    <aside className="detail-band equity-detail-band" aria-live="polite">
      <div>
        <small>{t.equity.selectedWeek}</small>
        <strong>{selected.weekKey}</strong>
      </div>
      <div>
        <small>{t.equity.tradingDays}</small>
        <strong>{selected.assets.QQQ?.tradingStart} → {selected.assets.QQQ?.tradingEnd}</strong>
      </div>
      <div>
        <small>{t.equity.qqqReturn}</small>
        <strong className={selected.assets.QQQ?.pct >= 0 ? "positive" : "negative"}>{formatPct(selected.assets.QQQ?.pct, 2)}</strong>
      </div>
      <div>
        <small>{t.equity.spyReturn}</small>
        <strong className={selected.assets.SPY?.pct >= 0 ? "positive" : "negative"}>{formatPct(selected.assets.SPY?.pct, 2)}</strong>
      </div>
      <div>
        <small>{t.equity.relativeReturn}</small>
        <strong className={selected.relativePct >= 0 ? "positive" : "negative"}>{formatPct(selected.relativePct, 2)}</strong>
      </div>
      <div>
        <small>{t.equity.tenYear}</small>
        <strong className={macroClass(tenYear?.changeBp)}>{formatBp(tenYear?.changeBp)}</strong>
      </div>
      <div>
        <small>{t.equity.vix}</small>
        <strong className={macroClass(vix?.change)}>{formatNumber(vix?.change, 2)}</strong>
      </div>
      <div>
        <small>{t.equity.leader}</small>
        <strong>{selected.leader || "N/A"}</strong>
      </div>
      <div>
        <small>{t.equity.dataSource}</small>
        <strong>{dataset.assets.QQQ.sourceLabel}</strong>
      </div>
      <div className="ranking-line">
        <small>{t.equity.events}</small>
        <strong>{selected.events?.length ? selected.events.map((event) => event.title).join("  ") : t.equity.eventPlaceholder}</strong>
      </div>
    </aside>
  );
}

export function EquityTooltip({ value, t }) {
  if (!value?.week) return null;
  const week = value.week;
  const tenYear = latestMacro(week, "DGS10");
  const vix = latestMacro(week, "VIXCLS");
  return (
    <div
      className="cell-tooltip equity-tooltip"
      style={{
        left: Math.max(8, Math.min(value.x + 14, window.innerWidth - 312)),
        top: Math.max(8, Math.min(value.y + 14, window.innerHeight - 210)),
      }}
    >
      <strong>{week.weekKey}</strong>
      <span>{t.equity.qqq}: {formatPct(week.assets.QQQ?.pct, 2)} / {formatCompactPrice(week.assets.QQQ?.close)}</span>
      <span>{t.equity.spy}: {formatPct(week.assets.SPY?.pct, 2)} / {formatCompactPrice(week.assets.SPY?.close)}</span>
      <span>{t.equity.relative}: {formatPct(week.relativePct, 2)}</span>
      <span>{t.equity.tenYear}: {formatBp(tenYear?.changeBp)} · {t.equity.vix}: {formatNumber(vix?.change, 2)}</span>
      <small>{week.events?.length ? `${week.events.length} ${t.equity.events}` : t.equity.noEvents}</small>
    </div>
  );
}

export function EquityMacroPage({ language, setLanguage, t }) {
  const copy = equityCopy(t);
  const summaryLive = useLiveData(EQUITY_SUMMARY_LIVE_DATA);
  const chartEnabled = useDeferredActivation(Boolean(summaryLive.data.equityWeekly));
  const chartLive = useLiveData(EQUITY_CHART_LIVE_DATA, { enabled: chartEnabled });
  const slowDataset = summaryLive.data.equityWeekly;
  const dataset = useMemo(() => slowDataset || summaryLive.data.equityFast ? {
    ...(slowDataset || {}),
    fast: summaryLive.data.equityFast,
    chartSeries: chartLive.data.chartSeries,
  } : null, [chartLive.data.chartSeries, slowDataset, summaryLive.data.equityFast]);
  const freshnessItems = [
    buildFreshnessItem(language === "en" ? "Slow calendar" : "\u6162\u901f\u65e5\u5386", summaryLive.freshness.equityWeekly, slowDataset),
    buildFreshnessItem(language === "en" ? "Fast indicators" : "\u5feb\u901f\u6307\u6807", summaryLive.freshness.equityFast, summaryLive.data.equityFast),
    buildFreshnessItem(language === "en" ? "Chart series" : "\u4ea4\u4e92\u56fe\u8868", chartLive.freshness.chartSeries, chartLive.data.chartSeries),
  ];
  const [visibleWeekDate, setVisibleWeekDate] = useState(null);
  const [visibleMonth, setVisibleMonth] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const todayKey = useAutoLocalDateKey();

  useEffect(() => {
    replaceHashState("equity-macro", {});
  }, []);

  useEffect(() => {
    if (!slowDataset) return;
    const focusDate = todayKey || latestEquityDate(slowDataset);
    const latestDate = latestEquityDate(slowDataset);
    setVisibleWeekDate((current) => current || focusDate);
    setVisibleMonth((current) => current || monthKeyFromDateKey(focusDate));
    setSelectedDate((current) => current || latestDate || focusDate);
  }, [slowDataset, todayKey]);

  if (summaryLive.error && !dataset) {
    return <DataState as="main" variant="error" className="status-page"><h1>{copy.unavailable}</h1><p>{summaryLive.error.status ? `${t.status.dataFileFailed} (${summaryLive.error.status})` : summaryLive.error.message}</p></DataState>;
  }
  if (!dataset) {
    return <DataState as="main" variant="loading" className="status-page"><p>{copy.loading}</p></DataState>;
  }
  const failureCount = [...(slowDataset?.failures || []), ...(dataset.fast?.failures || []), ...(dataset.chartSeries?.failures || [])].length;

  return (
    <main className="app-page equity-page">
      <header className="app-header">
        <div className="title-block">
          <p className="eyebrow">{copy.eyebrow}</p>
          <h1><span>{copy.titleAccent}</span> {copy.titleRest}</h1>
          <p>{copy.subtitle}</p>
          <PageNav page="equity" t={t} />
        </div>
        <div className="freshness-block">
          <LanguageToggle language={language} onChange={setLanguage} t={t} />
          <CacheStatus label={copy.cache} tooltip={copy.cacheTooltip} />
          <DataFreshnessSummary items={freshnessItems} language={language} t={t} />
          <small>{failureCount ? copy.failure(failureCount) : copy.success}</small>
        </div>
      </header>

      <EquityMarketSummary dataset={dataset} t={t} />
      <MetricComparePanel chartDataset={dataset.chartSeries} language={language} t={t} />

      {!slowDataset ? (
        <DataState as="section" variant="loading" className="visualization equity-progressive-placeholder" data-testid="equity-details-loading" aria-live="polite">
          <p>{copy.loading}</p>
        </DataState>
      ) : null}

      {slowDataset && visibleWeekDate ? (
        <EquityMarketWeekCalendar
          dataset={dataset}
          visibleWeekDate={visibleWeekDate}
          setVisibleWeekDate={setVisibleWeekDate}
          t={t}
        />
      ) : null}

      {slowDataset && visibleMonth ? (
        <EquityMarketMonthCalendar
          dataset={dataset}
          visibleMonth={visibleMonth}
          setVisibleMonth={setVisibleMonth}
          selectedDate={selectedDate || latestEquityDate(slowDataset)}
          setSelectedDate={setSelectedDate}
          language={language}
          t={t}
        />
      ) : null}

      <DataTrustFooter
        t={t}
        language={language}
        freshnessItems={freshnessItems}
        failures={failureCount}
        sources={[
          `QQQ / SPY / DIA - ${slowDataset?.assets?.QQQ?.sourceLabel || copy.waitingForFastData}`,
          `PHLX SOX (^SOX) - ${slowDataset?.assets?.SOX?.sourceLabel || copy.waitingForFastData}`,
          "FRED - DGS10 / VIXCLS / DEXCHUS / Gold proxy",
          "CoinMarketCap when configured",
          "Reviewed crypto supply and CEX anniversary calendar anchors",
          "Built-in NYSE holiday rules",
        ]}
        methodology={language === "zh" ? copy.methodology : [copy.methodology, dataset.fast?.methodology]}
        limitations={[copy.priceSourceNote, copy.eventPlaceholder]}
      />

    </main>
  );
}
