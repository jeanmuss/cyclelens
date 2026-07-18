import { PREFERENCE_KEYS, readPreference, writePreference } from "../../localPreferences.js";
import { DASHBOARD_WIDGET_DEFINITIONS, DASHBOARD_WIDGET_DEFINITION_BY_ID } from "./widgetDefinitions.js";

export const DASHBOARD_LAYOUT_VERSION = 2;

const defaultOrder = Object.freeze([...DASHBOARD_WIDGET_DEFINITIONS]
  .sort((left, right) => left.defaultPosition - right.defaultPosition)
  .map((definition) => definition.id));

function freezeLayout(layout) {
  return Object.freeze({
    version: DASHBOARD_LAYOUT_VERSION,
    order: Object.freeze([...layout.order]),
    hidden: Object.freeze([...layout.hidden]),
  });
}

export const DEFAULT_DASHBOARD_LAYOUT = freezeLayout({ order: defaultOrder, hidden: [] });

function knownWidgetIds(values) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string")) return null;
  const unique = [...new Set(values.filter((id) => DASHBOARD_WIDGET_DEFINITION_BY_ID[id]))];
  return unique;
}

function normalizeCurrentLayout(value) {
  const knownOrder = knownWidgetIds(value?.order);
  const knownHidden = knownWidgetIds(value?.hidden);
  if (!knownOrder || !knownHidden) return undefined;
  const order = [...knownOrder, ...defaultOrder.filter((id) => !knownOrder.includes(id))];
  return freezeLayout({ order, hidden: knownHidden.filter((id) => order.includes(id)) });
}

function migrateVersionOne(value) {
  if (!Array.isArray(value?.widgets)) return undefined;
  const entries = value.widgets.filter((entry) => (
    entry && typeof entry.id === "string" && typeof entry.visible === "boolean"
  ));
  if (entries.length !== value.widgets.length) return undefined;
  const order = knownWidgetIds(entries.map((entry) => entry.id));
  if (!order) return undefined;
  const hidden = entries.filter((entry) => !entry.visible).map((entry) => entry.id);
  return normalizeCurrentLayout({ order, hidden });
}

export function parseDashboardLayout(value) {
  if (typeof value !== "string" || !value) return undefined;
  try {
    const parsed = JSON.parse(value);
    if (parsed?.version === DASHBOARD_LAYOUT_VERSION) return normalizeCurrentLayout(parsed);
    if (parsed?.version === 1) return migrateVersionOne(parsed);
    return undefined;
  } catch {
    return undefined;
  }
}

export function readDashboardLayoutPreference({
  storage,
  key = PREFERENCE_KEYS.dashboardLayout,
} = {}) {
  return readPreference({
    ...(storage ? { storage } : {}),
    key,
    parse: parseDashboardLayout,
    fallback: DEFAULT_DASHBOARD_LAYOUT,
  });
}

export function writeDashboardLayoutPreference(layout, {
  storage,
  key = PREFERENCE_KEYS.dashboardLayout,
} = {}) {
  const normalized = normalizeCurrentLayout(layout);
  if (!normalized) return false;
  return writePreference({
    ...(storage ? { storage } : {}),
    key,
    value: JSON.stringify(normalized),
  });
}

export function setDashboardWidgetVisibility(layout, widgetId, visible) {
  const normalized = normalizeCurrentLayout(layout) || DEFAULT_DASHBOARD_LAYOUT;
  if (!DASHBOARD_WIDGET_DEFINITION_BY_ID[widgetId]) return normalized;
  const hidden = visible
    ? normalized.hidden.filter((id) => id !== widgetId)
    : [...new Set([...normalized.hidden, widgetId])];
  return freezeLayout({ order: normalized.order, hidden });
}

export function moveDashboardWidget(layout, widgetId, direction) {
  const normalized = normalizeCurrentLayout(layout) || DEFAULT_DASHBOARD_LAYOUT;
  const currentIndex = normalized.order.indexOf(widgetId);
  const nextIndex = currentIndex + Math.sign(Number(direction) || 0);
  if (currentIndex < 0 || nextIndex < 0 || nextIndex >= normalized.order.length) return normalized;
  const order = [...normalized.order];
  [order[currentIndex], order[nextIndex]] = [order[nextIndex], order[currentIndex]];
  return freezeLayout({ order, hidden: normalized.hidden });
}
