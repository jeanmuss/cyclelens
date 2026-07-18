export const MACRO_CALENDAR_TIME_ZONES = {
  zh: "Asia/Shanghai",
  en: "America/New_York",
};

export function macroCategoryLabel(category, t) {
  if (category === "all") return t.macroCalendar.all;
  if (category === "liquidity") return t.macroCalendar.liquidity;
  if (category === "sell-pressure-exhausted") return t.macroCalendar.sellPressureExhausted;
  return t.macroCalendar.categories[category] || category;
}

export function compactMacroCategoryLabel(category, t) {
  return t.macroCalendar.compactCategories?.[category] || macroCategoryLabel(category, t);
}

export function macroDateMeaningLabel(value, t) {
  if (value === "observation_period" || value === "observation_week") return t.macroCalendar.observationPeriod;
  if (value === "daily_observation") return t.macroCalendar.dailyObservation;
  if (value === "projection_year") return t.macroCalendar.projectionYear;
  if (value === "sep_release_observation") return t.macroCalendar.sepProjection;
  if (value === "scheduled_beijing_date") return t.macroCalendar.scheduledBeijingDate;
  if (value === "observed_holiday_date") return t.macroCalendar.observedHolidayDate;
  return value || "N/A";
}
