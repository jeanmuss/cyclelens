import { useState } from "react";

import { freshnessLabel } from "../data.js";
import {
  dashboardMetricMap,
  dashboardSourceLabels,
  missingDashboardMetricCount,
} from "../features/dashboard/dashboardModel.js";
import {
  DEFAULT_DASHBOARD_LAYOUT,
  moveDashboardWidget,
  readDashboardLayoutPreference,
  setDashboardWidgetVisibility,
  writeDashboardLayoutPreference,
} from "../features/dashboard/dashboardPreferences.js";
import {
  DASHBOARD_WIDGET_REGISTRY,
  DASHBOARD_WIDGET_REGISTRY_BY_ID,
} from "../features/dashboard/widgetRegistry.jsx";
import { CacheStatus } from "../shared/components/CacheStatus.jsx";
import { DataState } from "../shared/components/DataState.jsx";
import { buildFreshnessItem, DataFreshnessSummary, DataTrustFooter } from "../shared/components/DataTrust.jsx";
import { LanguageToggle } from "../shared/components/LanguageToggle.jsx";
import { DASHBOARD_LIVE_DATA } from "../shared/data/liveDataDefinitions.js";
import { PageNav } from "../shared/routing/PageNav.jsx";
import { useLiveData } from "../useLiveData.js";

const COPY = Object.freeze({
  zh: Object.freeze({
    eyebrow: "CYCLELENS · DASHBOARD",
    title: "风险资产数据看板",
    subtitle: "把跨市场指标集中到一份可审计的公开快照；无需登录即可浏览和定制。",
    cache: "单一公开投影",
    cacheTooltip: "首页只读取 CI 生成的 dashboard.json，不会从浏览器逐个请求数据商，也不会接触提供方凭据。",
    loading: "正在读取首页公开投影…",
    unavailable: "首页公开投影暂时不可用",
    available: "公开投影已加载",
    partial: "部分指标尚未发布",
    customize: "本设备布局",
    customizeHint: "显示状态与顺序只保存在此浏览器，不会上传。",
    show: "显示",
    moveUp: "上移",
    moveDown: "下移",
    reset: "恢复默认布局",
    empty: "所有卡片都已隐藏。可在右侧重新显示，或恢复默认布局。",
    metrics: "项指标",
    updated: "观测更新",
    quality: "质量",
    qualityAvailable: "官方或可用",
    qualityDerived: "衍生值",
    qualityStale: "最近可用缓存",
    qualityUnknown: "待发布",
    notPublished: "当前公开投影未包含；可能仍待来源许可或新数据。",
    methodology: "卡片只消费统一 metric catalog 生成的 dashboard projection；时间表示源数据观测时间，而不是页面生成时间。",
    limitations: "未获公开展示许可或尚无合格观测的数据不会进入投影；N/A 不会被补零。",
    dataNotes: "统一数据说明",
  }),
  en: Object.freeze({
    eyebrow: "CYCLELENS · DASHBOARD",
    title: "Risk Asset Dashboard",
    subtitle: "Cross-market metrics in one auditable public snapshot, available and customizable without an account.",
    cache: "Single public projection",
    cacheTooltip: "The homepage reads only CI-generated dashboard.json. The browser never calls providers individually or receives provider credentials.",
    loading: "Loading the public dashboard projection…",
    unavailable: "The public dashboard projection is unavailable",
    available: "Public projection loaded",
    partial: "Some metrics are not published",
    customize: "Layout on this device",
    customizeHint: "Visibility and order stay in this browser and are never uploaded.",
    show: "Show",
    moveUp: "Move up",
    moveDown: "Move down",
    reset: "Restore default layout",
    empty: "Every card is hidden. Show one from the controls or restore the default layout.",
    metrics: "metrics",
    updated: "Observed",
    quality: "Quality",
    qualityAvailable: "Official or available",
    qualityDerived: "Derived value",
    qualityStale: "Last known good",
    qualityUnknown: "Pending",
    notPublished: "Not in the current public projection; source approval or a new observation may still be pending.",
    methodology: "Cards consume only the dashboard projection generated from the shared metric catalog. Times describe source observations, not page generation.",
    limitations: "Data without public-display approval or a qualified observation is excluded; N/A is never filled with zero.",
    dataNotes: "Unified data notes",
  }),
});

function scrollToDataNotes() {
  document.getElementById("dashboard-data-notes")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function DashboardPage({ language, setLanguage, t }) {
  const copy = COPY[language];
  const { data, error, loading, freshness } = useLiveData(DASHBOARD_LIVE_DATA);
  const [layout, setLayout] = useState(readDashboardLayoutPreference);
  const projection = data.dashboardProjection;
  const metricMap = dashboardMetricMap(projection);
  const orderedWidgets = layout.order.map((id) => DASHBOARD_WIDGET_REGISTRY_BY_ID[id]).filter(Boolean);
  const visibleWidgets = orderedWidgets.filter((definition) => !layout.hidden.includes(definition.id));
  const missingCount = projection ? missingDashboardMetricCount(projection, DASHBOARD_WIDGET_REGISTRY) : 0;
  const freshnessItems = projection ? [buildFreshnessItem(
    language === "en" ? "Dashboard projection" : "首页公开投影",
    freshness.dashboardProjection,
    projection,
  )] : [];

  const applyLayout = (nextLayout) => {
    setLayout(nextLayout);
    writeDashboardLayoutPreference(nextLayout);
  };

  return (
    <main className="app-page dashboard-page">
      <header className="app-header">
        <div className="title-block">
          <p className="eyebrow">{copy.eyebrow}</p>
          <h1>{copy.title}</h1>
          <p>{copy.subtitle}</p>
          <PageNav page="dashboard" t={t} />
        </div>
        <div className="freshness-block">
          <LanguageToggle language={language} onChange={setLanguage} t={t} />
          <CacheStatus label={copy.cache} tooltip={copy.cacheTooltip} />
          {projection ? (
            <strong className={missingCount ? "macro-flat" : "macro-up"}>{missingCount ? copy.partial : copy.available}</strong>
          ) : null}
          <small>{projection ? freshnessLabel(projection.freshness?.observedAt, language) : copy.loading}</small>
        </div>
      </header>

      {freshnessItems.length ? <DataFreshnessSummary items={freshnessItems} language={language} t={t} /> : null}

      <div className="dashboard-layout">
        <section className="dashboard-board" aria-label={copy.title}>
          {loading && !projection ? <DataState variant="loading"><p>{copy.loading}</p></DataState> : null}
          {error && !projection ? <DataState variant="error"><p>{copy.unavailable}</p></DataState> : null}
          {projection && !visibleWidgets.length ? <DataState variant="empty"><p>{copy.empty}</p></DataState> : null}
          {projection ? visibleWidgets.map((definition) => {
            const Widget = definition.component;
            return <Widget key={definition.id} definition={definition} language={language} metricMap={metricMap} copy={copy} />;
          }) : null}
        </section>

        <aside className="dashboard-customizer" aria-label={copy.customize}>
          <header>
            <div><p>LOCAL PREFERENCE</p><h2>{copy.customize}</h2></div>
            <button type="button" onClick={scrollToDataNotes}>{copy.dataNotes}</button>
          </header>
          <p>{copy.customizeHint}</p>
          <ol>
            {orderedWidgets.map((definition, index) => {
              const visible = !layout.hidden.includes(definition.id);
              return (
                <li key={definition.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={visible}
                      onChange={(event) => applyLayout(setDashboardWidgetVisibility(layout, definition.id, event.target.checked))}
                    />
                    <span>{definition.title[language]}</span>
                  </label>
                  <div>
                    <button
                      type="button"
                      aria-label={`${copy.moveUp}: ${definition.title[language]}`}
                      disabled={index === 0}
                      onClick={() => applyLayout(moveDashboardWidget(layout, definition.id, -1))}
                    >↑</button>
                    <button
                      type="button"
                      aria-label={`${copy.moveDown}: ${definition.title[language]}`}
                      disabled={index === orderedWidgets.length - 1}
                      onClick={() => applyLayout(moveDashboardWidget(layout, definition.id, 1))}
                    >↓</button>
                  </div>
                </li>
              );
            })}
          </ol>
          <button className="dashboard-reset" type="button" onClick={() => applyLayout(DEFAULT_DASHBOARD_LAYOUT)}>{copy.reset}</button>
        </aside>
      </div>

      {projection ? (
        <div id="dashboard-data-notes">
          <DataTrustFooter
            t={t}
            language={language}
            freshnessItems={freshnessItems}
            sources={dashboardSourceLabels(projection)}
            methodology={copy.methodology}
            limitations={copy.limitations}
            failures={0}
          />
        </div>
      ) : null}
    </main>
  );
}
