import { useEffect, useMemo, useState } from "react";
import { formatPct } from "../data.js";
import { MACRO_LIVE_DATA } from "../shared/data/liveDataDefinitions.js";
import { useLiveData } from "../useLiveData.js";
import { PageNav } from "../shared/routing/PageNav.jsx";
import { macroCategoryLabel, macroDateMeaningLabel } from "../shared/i18n/macro.js";
import { replaceHashState } from "../shared/routing/routeViewState.js";
import { CacheStatus } from "../shared/components/CacheStatus.jsx";
import { DataFreshnessSummary, DataTrustFooter, buildFreshnessItem } from "../shared/components/DataTrust.jsx";
import { DataState } from "../shared/components/DataState.jsx";
import { LanguageToggle } from "../shared/components/LanguageToggle.jsx";
import {
  isMacroNumber,
  macroMoveClass,
  formatMacroValue,
  formatMacroChange,
} from "../shared/formatting/metrics.js";
import {
  utcDateFromKey,
  dateKeyFromUtc,
  localDateKeyForLanguage,
  addUtcDays,
  weekDaysFor,
  monthKeyFromDateKey,
  monthGrid,
  shiftMonth,
  monthTitle,
  dayLabel,
  findCurrentWeeklyState,
  findWeeklyStateForDate,
  macroEventLabel,
  compactIndicatorLabel,
  statusItemsForWeek,
  eventsByDate,
  isHolidayEvent,
  holidayCountryCode,
  holidayCountryLabel,
  holidayCountryCodesForDate,
  buildWeekDayItems,
  buildMonthItems,
  buildMonthDetailItems,
  environmentSummary,
} from "../features/macro/macroCalendarModel.js";

export function MacroEnvironmentPanel({ dataset, t }) {
  const currentWeek = findCurrentWeeklyState(dataset);
  const summary = environmentSummary(currentWeek, t);
  return (
    <section className="macro-environment" aria-label={t.macroCalendar.environmentTitle}>
      <div className="macro-section-heading">
        <div>
          <p>{t.macroCalendar.currentWeek}</p>
          <h2>{t.macroCalendar.environmentTitle}</h2>
        </div>
        <span>{currentWeek ? `${currentWeek.weekStart} - ${currentWeek.weekEnd}` : "N/A"}</span>
      </div>
      <div className="macro-environment-grid">
        {summary.cards.map((card) => (
          <div className="macro-environment-card" key={card.label}>
            <small>{card.label}</small>
            <strong className={card.className}>{card.value}</strong>
            <span className={card.className}>{card.delta}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function MacroWeekCalendar({ dataset, language, t }) {
  const [visibleWeekDate, setVisibleWeekDate] = useState(() => localDateKeyForLanguage(language));
  const eventMap = useMemo(() => eventsByDate(dataset.events || [], language), [dataset, language]);
  const days = useMemo(() => weekDaysFor(visibleWeekDate, language), [visibleWeekDate, language]);
  const visibleWeek = useMemo(() => findWeeklyStateForDate(dataset, visibleWeekDate), [dataset, visibleWeekDate]);
  const statusItems = statusItemsForWeek(visibleWeek);
  const shiftVisibleWeek = (daysToAdd) => {
    setVisibleWeekDate((current) => dateKeyFromUtc(addUtcDays(utcDateFromKey(current), daysToAdd)));
  };
  return (
    <section className="visualization macro-calendar-section" aria-label={t.macroCalendar.weekCalendarTitle}>
      <div className="macro-section-heading">
        <div>
          <p>{t.macroCalendar.currentWeek}</p>
          <h2>{t.macroCalendar.weekCalendarTitle}</h2>
        </div>
        <span>{days[0].dateKey} - {days[6].dateKey}</span>
      </div>
      <div className="macro-week-carousel">
        <button type="button" className="macro-week-nav macro-week-prev" onClick={() => shiftVisibleWeek(-7)} aria-label={t.macroCalendar.previousWeek}>
          <span aria-hidden="true">&lt;</span>
        </button>
        <div className="table-shell macro-week-shell">
          <table className="macro-week-calendar">
            <caption className="sr-only">{t.macroCalendar.weekCalendarTitle}</caption>
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
                  const items = buildWeekDayItems(day.dateKey, eventMap, statusItems, t);
                  return (
                    <td
                      key={day.dateKey}
                      className={[
                        items.length ? "" : "macro-calendar-empty",
                        day.isToday ? "is-today" : "",
                      ].filter(Boolean).join(" ")}
                    >
                      {items.map((item) => (
                        <span className={`macro-mini-chip macro-${item.category}`} key={`${item.type}-${item.text}`}>
                          {item.text}
                        </span>
                      ))}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
        <button type="button" className="macro-week-nav macro-week-next" onClick={() => shiftVisibleWeek(7)} aria-label={t.macroCalendar.nextWeek}>
          <span aria-hidden="true">&gt;</span>
        </button>
      </div>
      <p className="macro-calendar-note">{t.macroCalendar.periodNotice}</p>
    </section>
  );
}

export function MacroMonthCalendar({ dataset, selectedDate, setSelectedDate, visibleMonth, setVisibleMonth, language, t }) {
  const eventMap = useMemo(() => eventsByDate(dataset.events || [], language), [dataset, language]);
  const days = useMemo(() => monthGrid(visibleMonth, language), [visibleMonth, language]);
  const selectedItems = buildMonthDetailItems(selectedDate, dataset, eventMap, t);
  return (
    <section className="visualization macro-calendar-section" aria-label={t.macroCalendar.monthCalendarTitle}>
      <div className="macro-section-heading">
        <div>
          <p>{t.macroCalendar.clickDateHint}</p>
          <h2>{t.macroCalendar.monthCalendarTitle}</h2>
        </div>
        <div className="macro-month-controls">
          <button type="button" onClick={() => setVisibleMonth((month) => shiftMonth(month, -1))}>{t.macroCalendar.previousMonth}</button>
          <strong>{monthTitle(visibleMonth, language)}</strong>
          <button type="button" onClick={() => setVisibleMonth((month) => shiftMonth(month, 1))}>{t.macroCalendar.nextMonth}</button>
        </div>
      </div>
      <div className="macro-month-shell">
        <div className="macro-month-weekdays">
          {t.macroCalendar.weekdays.map((day) => <span key={day}>{day}</span>)}
        </div>
        <div className="macro-month-grid">
          {days.map((day) => {
            const items = buildMonthItems(day.dateKey, dataset, eventMap, t);
            const holidayCountries = holidayCountryCodesForDate(eventMap, day.dateKey);
            return (
              <button
                type="button"
                key={day.dateKey}
                className={[
                  "macro-month-day",
                  day.inMonth ? "" : "is-muted",
                  day.dateKey === selectedDate ? "is-selected" : "",
                  day.isToday ? "is-today" : "",
                  items.length ? "has-items" : "",
                ].filter(Boolean).join(" ")}
                onClick={() => setSelectedDate(day.dateKey)}
              >
                <span className="macro-month-date-line">
                  <strong>{day.dayOfMonth}</strong>
                  {holidayCountries.length ? (
                    <span className="macro-country-markers">
                      {holidayCountries.map((countryCode) => (
                        <span className={`macro-country-marker country-${countryCode.toLowerCase()}`} title={holidayCountryLabel(countryCode, t)} key={countryCode}>
                          {countryCode}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </span>
                <span className="macro-month-items">
                  {items.length ? items.map((item) => (
                    <small className={`macro-month-tag macro-${item.category}`} title={item.label || item.text} key={`${item.type}-${item.text}`}>{item.text}</small>
                  )) : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <MacroDateDetails dateKey={selectedDate} items={selectedItems} t={t} />
    </section>
  );
}

export function holidayDisplayName(event, t) {
  if (t.htmlLang === "zh-CN" && event?.holidayNameZh) return event.holidayNameZh;
  return event?.holidayName || macroEventLabel(event, t);
}

export function holidayDateNote(event, t) {
  const observedDate = event?.observedDate || event?.date;
  const legalDate = event?.legalDate || observedDate;
  if (!observedDate) return event?.note || "";
  if (legalDate && legalDate !== observedDate) {
    return t.macroCalendar.holidayObservedNote(observedDate, legalDate);
  }
  return t.macroCalendar.holidaySameDayNote(observedDate);
}

export function MacroDateEventDetail({ item, t }) {
  const event = item.event;
  if (isHolidayEvent(event)) {
    const countryCode = holidayCountryCode(event);
    return (
      <div className="macro-date-detail-item macro-holiday-detail-item">
        <span className={`macro-pill macro-${item.category}`}>{macroCategoryLabel(item.category, t)}</span>
        <strong>{macroEventLabel(event, t)}</strong>
        <dl>
          <div><dt>{t.macroCalendar.holiday}</dt><dd>{holidayDisplayName(event, t)}</dd></div>
          <div><dt>{t.macroCalendar.observedDate}</dt><dd>{event.observedDate || event.date || "N/A"}</dd></div>
          <div><dt>{t.macroCalendar.legalDate}</dt><dd>{event.legalDate || event.observedDate || event.date || "N/A"}</dd></div>
          <div><dt>{t.macroCalendar.country}</dt><dd>{holidayCountryLabel(countryCode, t)}</dd></div>
        </dl>
        <small>{holidayDateNote(event, t)} / {event.source}</small>
      </div>
    );
  }
  return (
    <div className="macro-date-detail-item">
      <span className={`macro-pill macro-${item.category}`}>{macroCategoryLabel(item.category, t)}</span>
      <strong>{macroEventLabel(event, t)}</strong>
      <dl>
        <div><dt>{t.macroCalendar.previous}</dt><dd>{formatMacroValue(event.previous, event.unit)}</dd></div>
        <div><dt>{t.macroCalendar.actual}</dt><dd>{formatMacroValue(event.actual, event.unit)}</dd></div>
        <div><dt>{t.macroCalendar.change}</dt><dd className={macroMoveClass(event.change)}>{formatMacroChange(event)}</dd></div>
        <div><dt>{t.macroCalendar.yoy}</dt><dd className={macroMoveClass(event.yoyPct)}>{isMacroNumber(event.yoyPct) ? formatPct(event.yoyPct, 2) : "N/A"}</dd></div>
      </dl>
      <small>{macroDateMeaningLabel(event.dateMeaning, t)} / {event.source}</small>
    </div>
  );
}

export function MacroDateDetails({ dateKey, items, t }) {
  return (
    <aside className="macro-date-detail" aria-live="polite">
      <div className="macro-date-detail-heading">
        <div>
          <small>{t.macroCalendar.selectedDate}</small>
          <strong>{dateKey}</strong>
        </div>
        <span>{items.length ? `${items.length} ${t.macroCalendar.eventCount}` : t.macroCalendar.noIndicators}</span>
      </div>
      {items.length ? (
        <div className="macro-date-detail-list">
          {items.map((item) => item.type === "event" ? (
            <MacroDateEventDetail item={item} t={t} key={`${item.event.seriesId}-${item.event.date}-${item.displayDate || dateKey}`} />
          ) : item.type === "status" ? (
            <div className="macro-date-detail-item" key={`${item.type}-${item.seriesId}-${item.date}`}>
              <span className={`macro-pill macro-${item.category}`}>{macroCategoryLabel(item.category, t)}</span>
              <strong>{item.value.label || item.label}</strong>
              <dl>
                <div><dt>{t.macroCalendar.previous}</dt><dd>{formatMacroValue(item.value.start, item.value.unit)}</dd></div>
                <div><dt>{t.macroCalendar.actual}</dt><dd>{formatMacroValue(item.value.end, item.value.unit)}</dd></div>
                <div><dt>{t.macroCalendar.change}</dt><dd className={macroMoveClass(item.value.changeBp ?? item.value.change)}>{formatMacroChange(item.value)}</dd></div>
                <div><dt>{t.macroCalendar.dateMeaning}</dt><dd>{item.value.observationStart === item.value.observationEnd ? dayLabel(item.value.observationEnd) : `${dayLabel(item.value.observationStart)}-${dayLabel(item.value.observationEnd)}`}</dd></div>
              </dl>
              <small>{macroDateMeaningLabel(item.value.dateMeaning, t)} / {item.value.source || item.seriesId}</small>
            </div>
          ) : (
            <div className="macro-date-detail-item" key={`${item.type}-${item.text}`}>
              <span className={`macro-pill macro-${item.category}`}>{macroCategoryLabel(item.category, t)}</span>
              <strong>{item.label}</strong>
              <small>{item.label === t.macroCalendar.earningsSeasonWindow ? t.macroCalendar.earningsSeasonNotice : t.macroCalendar.periodNotice}</small>
            </div>
          ))}
        </div>
      ) : (
        <p>{t.macroCalendar.noIndicators}</p>
      )}
    </aside>
  );
}

export function MacroSummaryStrip({ dataset, t }) {
  return (
    <div className="latest-strip macro-summary-strip" aria-label={t.macroCalendar.window}>
      {(dataset.categorySummary || []).map((category) => (
        <div className="equity-summary-card macro-summary-card" key={category.category}>
          <span className="ticker">{macroCategoryLabel(category.category, t)}</span>
          <span className="latest-price">{category.eventCount} {t.macroCalendar.eventCount}</span>
          <span className="latest-return">{category.latestEventLabel ? compactIndicatorLabel(category.latestEventLabel, t) : t.macroCalendar.noLatest}</span>
          <small>{category.latestEventDate || category.latestStatus?.weekKey || t.macroCalendar.noLatest}</small>
        </div>
      ))}
    </div>
  );
}

export function MacroEventsTable({ rows, selected, onSelect, t }) {
  return (
    <div className="table-shell macro-events-shell">
      <table className="data-table macro-events-table">
        <caption className="sr-only">{t.macroCalendar.eventsCaption}</caption>
        <thead>
          <tr>
            <th className="macro-date-column">{t.macroCalendar.date}</th>
            <th>{t.macroCalendar.category}</th>
            <th>{t.macroCalendar.indicator}</th>
            <th>{t.macroCalendar.actual}</th>
            <th>{t.macroCalendar.previous}</th>
            <th>{t.macroCalendar.forecast}</th>
            <th>{t.macroCalendar.change}</th>
            <th>{t.macroCalendar.yoy}</th>
            <th>{t.macroCalendar.source}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((event) => (
            <tr key={`${event.seriesId}-${event.date}-${event.label}`} className={selected === event ? "selected-row" : ""}>
              <th scope="row">
                <button type="button" onClick={() => onSelect(event)}>
                  <strong>{event.date}</strong>
                  <span>{macroDateMeaningLabel(event.dateMeaning, t)}</span>
                </button>
              </th>
              <td><span className={`macro-pill macro-${event.category}`}>{macroCategoryLabel(event.category, t)}</span></td>
              <td>
                <button type="button" className="macro-row-button" onClick={() => onSelect(event)}>
                  <strong>{macroEventLabel(event, t)}</strong>
                  <span>{event.seriesId}</span>
                </button>
              </td>
              <td>{formatMacroValue(event.actual, event.unit)}</td>
              <td>{formatMacroValue(event.previous, event.unit)}</td>
              <td>{formatMacroValue(event.forecast, event.unit)}</td>
              <td className={macroMoveClass(event.change)}>{formatMacroChange(event)}</td>
              <td className={macroMoveClass(event.yoyPct)}>{isMacroNumber(event.yoyPct) ? formatPct(event.yoyPct, 2) : "N/A"}</td>
              <td className="macro-source-cell">{event.source}</td>
            </tr>
          )) : (
            <tr>
              <DataState as="td" variant="empty" colSpan="9" className="empty-table-cell">{t.macroCalendar.noRows}</DataState>
            </tr>
          )}
        </tbody>
      </table>
      <div className="table-note">{t.macroCalendar.methodology}</div>
    </div>
  );
}

export function MacroStateCell({ row, id, mode = "change", t }) {
  const item = row.values?.[id];
  if (!item) return <td className="return-na">N/A</td>;
  const moveValue = isMacroNumber(item.changeBp) ? item.changeBp : item.change;
  return (
    <td>
      <strong>{formatMacroValue(item.end, item.unit)}</strong>
      <span className={macroMoveClass(moveValue)}>
        {item.carriedForward && item.observationEnd
          ? t.macroCalendar.asOf(dayLabel(item.observationEnd))
          : mode === "pct" && isMacroNumber(item.pctChange)
            ? formatPct(item.pctChange, 2)
            : formatMacroChange(item)}
      </span>
    </td>
  );
}

export function MacroStateTable({ rows, t }) {
  return (
    <div className="table-shell macro-state-shell">
      <table className="data-table macro-state-table">
        <caption className="sr-only">{t.macroCalendar.stateCaption}</caption>
        <thead>
          <tr>
            <th className="week-column">{t.macroCalendar.week}</th>
            <th>{t.macroCalendar.twoYear}</th>
            <th>{t.macroCalendar.tenYear}</th>
            <th>{t.macroCalendar.realYield}</th>
            <th>{t.macroCalendar.dollar}</th>
            <th>{t.macroCalendar.vix}</th>
            <th>{t.macroCalendar.credit}</th>
            <th>{t.macroCalendar.stress}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.weekKey}>
              <th scope="row">
                <strong>{row.weekKey}</strong>
                <span>{row.weekStart} - {row.weekEnd}</span>
              </th>
              <MacroStateCell row={row} id="DGS2" t={t} />
              <MacroStateCell row={row} id="DGS10" t={t} />
              <MacroStateCell row={row} id="DFII10" t={t} />
              <MacroStateCell row={row} id="DTWEXBGS" mode="pct" t={t} />
              <MacroStateCell row={row} id="VIXCLS" t={t} />
              <td>
                <strong>{formatMacroValue(row.values?.BAMLH0A0HYM2?.end, row.values?.BAMLH0A0HYM2?.unit)}</strong>
                <span className={macroMoveClass(row.values?.BAMLH0A0HYM2?.changeBp)}>{formatMacroChange(row.values?.BAMLH0A0HYM2)}</span>
              </td>
              <MacroStateCell row={row} id="STLFSI4" t={t} />
            </tr>
          ))}
        </tbody>
      </table>
      <div className="table-note">{t.macroCalendar.stateCaption}</div>
    </div>
  );
}

export function MacroDetailBand({ selected, t }) {
  if (!selected) {
    return (
      <aside className="detail-band detail-empty macro-detail-empty" aria-live="polite">
        <strong>{t.macroCalendar.emptyDetailTitle}</strong>
        <span>{t.macroCalendar.emptyDetailBody}</span>
      </aside>
    );
  }
  return (
    <aside className="detail-band macro-detail-band" aria-live="polite">
      <div>
        <small>{t.macroCalendar.selected}</small>
        <strong>{selected.label}</strong>
      </div>
      <div>
        <small>{t.macroCalendar.date}</small>
        <strong>{selected.date}</strong>
      </div>
      <div>
        <small>{t.macroCalendar.category}</small>
        <strong>{macroCategoryLabel(selected.category, t)}</strong>
      </div>
      <div>
        <small>{t.macroCalendar.actual}</small>
        <strong>{formatMacroValue(selected.actual, selected.unit)}</strong>
      </div>
      <div>
        <small>{t.macroCalendar.previous}</small>
        <strong>{formatMacroValue(selected.previous, selected.unit)}</strong>
      </div>
      <div>
        <small>{t.macroCalendar.change}</small>
        <strong className={macroMoveClass(selected.change)}>{formatMacroChange(selected)}</strong>
      </div>
      <div>
        <small>{t.macroCalendar.yoy}</small>
        <strong className={macroMoveClass(selected.yoyPct)}>{isMacroNumber(selected.yoyPct) ? formatPct(selected.yoyPct, 2) : "N/A"}</strong>
      </div>
      <div>
        <small>{t.macroCalendar.dateMeaning}</small>
        <strong>{macroDateMeaningLabel(selected.dateMeaning, t)}</strong>
      </div>
      <div className="ranking-line">
        <small>{t.macroCalendar.source}</small>
        <strong>{selected.source}</strong>
      </div>
    </aside>
  );
}

export function MacroCalendarPage({ language, setLanguage, t }) {
  const { data: liveData, error, freshness: liveFreshness } = useLiveData(MACRO_LIVE_DATA);
  const dataset = liveData.macroCalendar;
  const freshnessItems = [buildFreshnessItem(language === "en" ? "Macro / FRED" : "\u5b8f\u89c2 / FRED", liveFreshness.macroCalendar, dataset)];
  const [selectedDate, setSelectedDate] = useState(null);
  const [visibleMonth, setVisibleMonth] = useState(null);

  useEffect(() => {
    replaceHashState("macro-calendar", {});
  }, []);

  const defaultDate = useMemo(() => {
    if (!dataset) return null;
    return localDateKeyForLanguage(language);
  }, [dataset, language]);

  useEffect(() => {
    if (!dataset) return;
    setVisibleMonth((current) => current || monthKeyFromDateKey(defaultDate || dataset.window.endDate));
    setSelectedDate((current) => current || defaultDate || dataset.window.endDate);
  }, [dataset, defaultDate]);

  if (error) {
    return <DataState as="main" variant="error" className="status-page"><h1>{t.macroCalendar.unavailable}</h1><p>{error.status ? `${t.status.dataFileFailed} (${error.status})` : error.message}</p></DataState>;
  }
  if (!dataset) {
    return <DataState as="main" variant="loading" className="status-page"><p>{t.macroCalendar.loading}</p></DataState>;
  }

  return (
    <main className="app-page macro-page">
      <header className="app-header">
        <div className="title-block">
          <p className="eyebrow">{t.macroCalendar.eyebrow}</p>
          <h1><span>{t.macroCalendar.titleAccent}</span> {t.macroCalendar.titleRest}</h1>
          <p>{t.macroCalendar.subtitle}</p>
          <PageNav page="macro" t={t} />
        </div>
        <div className="freshness-block">
          <LanguageToggle language={language} onChange={setLanguage} t={t} />
          <CacheStatus label={t.macroCalendar.cache} tooltip={t.macroCalendar.cacheTooltip} />
          <DataFreshnessSummary items={freshnessItems} language={language} t={t} />
          <small>{dataset.failures?.length ? t.macroCalendar.failure(dataset.failures.length) : t.macroCalendar.success}</small>
        </div>
      </header>

      <MacroEnvironmentPanel dataset={dataset} t={t} />
      <MacroWeekCalendar dataset={dataset} language={language} t={t} />
      {visibleMonth && selectedDate ? (
        <MacroMonthCalendar
          dataset={dataset}
          selectedDate={selectedDate}
          setSelectedDate={setSelectedDate}
          visibleMonth={visibleMonth}
          setVisibleMonth={setVisibleMonth}
          language={language}
          t={t}
        />
      ) : null}

      <DataTrustFooter
        t={t}
        language={language}
        freshnessItems={freshnessItems}
        failures={dataset.failures}
        sources={[
          "FRED",
          "FRED release-date API",
          "ADP official static data",
          "Federal Reserve FOMC calendar",
          "OPM federal holidays",
          "Manual China holiday annotations",
        ]}
        methodology={language === "zh" ? t.macroCalendar.methodology : dataset.methodology || t.macroCalendar.methodology}
        limitations={t.macroCalendar.sourceNote}
      />
    </main>
  );
}
