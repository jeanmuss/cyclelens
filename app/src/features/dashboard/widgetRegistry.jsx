import { MetricListWidget } from "./DashboardWidgets.jsx";
import { DASHBOARD_WIDGET_DEFINITIONS } from "./widgetDefinitions.js";

const componentById = Object.freeze({
  "metric-list": MetricListWidget,
});

export const DASHBOARD_WIDGET_REGISTRY = Object.freeze(DASHBOARD_WIDGET_DEFINITIONS.map((definition) => Object.freeze({
  ...definition,
  component: componentById[definition.componentId],
})));

export const DASHBOARD_WIDGET_REGISTRY_BY_ID = Object.freeze(Object.fromEntries(
  DASHBOARD_WIDGET_REGISTRY.map((definition) => [definition.id, definition]),
));
