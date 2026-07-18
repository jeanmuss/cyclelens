import { localDateKeyForLanguage } from "../../shared/dates/calendar.js";

export const ADMIN_MACRO_API_BASE = "http://127.0.0.1:5174";
export const ADMIN_MACRO_CATEGORIES = ["inflation", "growth", "rates", "volatility", "liquidity", "other"];
export const ADMIN_MACRO_DATE_MEANINGS = [
  "scheduled_beijing_date",
  "daily_observation",
  "observation_period",
  "observation_week",
  "observed_holiday_date",
];

export function adminMacroCopy(t) {
  const zh = t.htmlLang === "zh-CN";
  return zh ? {
    eyebrow: "LOCAL ADMIN",
    title: "宏观事件后台",
    subtitle: "配置 Supabase 时编辑数据库事件，并同步到本地缓存供日历脚本使用。",
    api: "本地 API",
    connected: "已连接",
    disconnected: "未连接",
    reload: "重新载入",
    saveAll: "保存事件",
    validate: "校验事件",
    publish: "发布到日历缓存",
    saveDraft: "更新当前事件",
    newEvent: "新建事件",
    duplicate: "复制",
    delete: "删除",
    eventList: "手动事件",
    editor: "事件编辑",
    preview: "时区预览",
    empty: "暂无手动事件",
    localOnly: "只连接 127.0.0.1:5174。密钥只由本地 API 读取，不进入浏览器或公开构建。",
    startApi: "先运行 npm run admin:macro-events，再运行 npm run dev 打开本页。",
    fields: {
      status: "状态",
      date: "日历日期",
      seriesId: "事件 ID",
      labelZh: "中文标题",
      labelEn: "英文标题",
      category: "类别",
      role: "角色",
      unit: "单位",
      source: "来源",
      sourceUrl: "来源链接",
      dateMeaning: "日期语义",
      releaseTimeUtc: "发布时间 UTC",
      actual: "实际",
      previous: "前值",
      forecast: "预测",
      note: "备注",
    },
    statusOptions: [
      { value: "published", label: "发布" },
      { value: "draft", label: "草稿" },
      { value: "archived", label: "归档" },
    ],
    validation: {
      date: "日期需要 YYYY-MM-DD",
      seriesId: "事件 ID 必填，只使用大写字母、数字、下划线、冒号或短横线",
      label: "中文或英文标题至少填一个",
      source: "来源必填",
      releaseTimeUtc: "UTC 发布时间无法解析",
    },
    saved: "已保存",
    loaded: "已载入",
    draftSaved: "当前事件已更新到列表，记得保存事件。",
    validationPassed: "校验通过",
    publishPassed: "发布完成",
    publishing: "处理中",
    publishStatus: "发布状态",
    manualEvents: "手动事件",
    publishedEvents: "可发布",
    draftEvents: "草稿",
    archivedEvents: "归档",
    calendarGenerated: "日历缓存",
    missingEvents: "未发布",
    readyToPublish: "已同步",
    beijingDate: "北京时间日期",
    newYorkDate: "纽约日期",
    displayDate: "保存日期",
    noReleaseTime: "未填写 UTC 发布时间时，中英日历都按保存日期落点。",
  } : {
    eyebrow: "LOCAL ADMIN",
    title: "Macro Event Admin",
    subtitle: "Edit Supabase-backed events when configured, with a local cache for the calendar script.",
    api: "Local API",
    connected: "Connected",
    disconnected: "Disconnected",
    reload: "Reload",
    saveAll: "Save events",
    validate: "Validate events",
    publish: "Publish calendar cache",
    saveDraft: "Update event",
    newEvent: "New event",
    duplicate: "Duplicate",
    delete: "Delete",
    eventList: "Manual events",
    editor: "Event editor",
    preview: "Time-zone preview",
    empty: "No manual events yet",
    localOnly: "Only talks to 127.0.0.1:5174. Secrets are read by the local API only and never reach the browser or public build.",
    startApi: "Run npm run admin:macro-events, then npm run dev to use this page.",
    readOnly: "The Supabase canonical store is not configured; the repository snapshot is read-only.",
    fields: {
      status: "Status",
      date: "Calendar date",
      seriesId: "Event ID",
      labelZh: "Chinese title",
      labelEn: "English title",
      category: "Category",
      role: "Role",
      unit: "Unit",
      source: "Source",
      sourceUrl: "Source URL",
      dateMeaning: "Date meaning",
      releaseTimeUtc: "Release time UTC",
      actual: "Actual",
      previous: "Previous",
      forecast: "Forecast",
      note: "Note",
    },
    statusOptions: [
      { value: "published", label: "Published" },
      { value: "draft", label: "Draft" },
      { value: "archived", label: "Archived" },
    ],
    validation: {
      date: "Date must be YYYY-MM-DD",
      seriesId: "Event ID is required and should use uppercase letters, numbers, underscores, colons, or hyphens",
      label: "Provide at least one Chinese or English title",
      source: "Source is required",
      releaseTimeUtc: "UTC release time cannot be parsed",
    },
    saved: "Saved",
    loaded: "Loaded",
    draftSaved: "Current event was updated in the list. Remember to save events.",
    validationPassed: "Validation passed",
    publishPassed: "Publish complete",
    publishing: "Working",
    publishStatus: "Publish status",
    manualEvents: "Manual events",
    publishedEvents: "Publishable",
    draftEvents: "Drafts",
    archivedEvents: "Archived",
    calendarGenerated: "Calendar cache",
    missingEvents: "Missing",
    readyToPublish: "Synced",
    beijingDate: "Beijing date",
    newYorkDate: "New York date",
    displayDate: "Saved date",
    noReleaseTime: "Without a UTC release time, both calendar languages use the saved date.",
  };
}

export function blankAdminMacroEvent(language) {
  const date = localDateKeyForLanguage(language);
  const suffix = date.replaceAll("-", "");
  return {
    status: "draft",
    date,
    seriesId: `MANUAL_LIQUIDITY_${suffix}`,
    label: "",
    labelZh: "",
    labelEn: "",
    category: "liquidity",
    role: "manual_liquidity_event",
    cadence: "event",
    unit: "event",
    source: "",
    sourceUrl: "",
    dateMeaning: "scheduled_beijing_date",
    releaseTimeUtc: "",
    actual: "",
    previous: "",
    forecast: "",
    note: "",
  };
}

export function adminEventKey(event) {
  return `${event?.seriesId || "event"}::${event?.date || "date"}`;
}

export function adminEventLabel(event, language) {
  return (language === "en" ? event?.labelEn : event?.labelZh) || event?.label || event?.seriesId || "N/A";
}

export function adminFormatDateTime(value, timeZone, language) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return new Intl.DateTimeFormat(language === "en" ? "en-US" : "zh-CN", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function adminValidationErrors(event, copy) {
  const errors = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(event.date || ""))) errors.push(copy.validation.date);
  if (!/^[A-Z0-9_:-]{3,80}$/.test(String(event.seriesId || ""))) errors.push(copy.validation.seriesId);
  if (!String(event.labelZh || event.labelEn || event.label || "").trim()) errors.push(copy.validation.label);
  if (!String(event.source || "").trim()) errors.push(copy.validation.source);
  if (event.releaseTimeUtc && Number.isNaN(new Date(event.releaseTimeUtc).getTime())) errors.push(copy.validation.releaseTimeUtc);
  return errors;
}

export function normalizeAdminEventForList(event) {
  const label = String(event.label || [event.labelZh, event.labelEn].filter(Boolean).join(" / ")).trim();
  const numberOrNull = (value) => value === "" || value == null ? null : Number(value);
  return {
    ...event,
    label,
    actual: numberOrNull(event.actual),
    previous: numberOrNull(event.previous),
    forecast: numberOrNull(event.forecast),
  };
}

export function adminResponseJson(response) {
  return response.json()
    .catch(() => ({}))
    .then((data) => {
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      return data;
    });
}
