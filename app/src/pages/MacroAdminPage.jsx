import { useEffect, useMemo, useState } from "react";
import { freshnessLabel } from "../data.js";
import { PageNav } from "../shared/routing/PageNav.jsx";
import { macroCategoryLabel, macroDateMeaningLabel } from "../shared/i18n/macro.js";
import { replaceHashState } from "../shared/routing/routeViewState.js";
import { CacheStatus } from "../shared/components/CacheStatus.jsx";
import { LanguageToggle } from "../shared/components/LanguageToggle.jsx";
import { dateKeyInTimeZone } from "../features/macro/macroCalendarModel.js";
import {
  ADMIN_MACRO_API_BASE,
  ADMIN_MACRO_CATEGORIES,
  ADMIN_MACRO_DATE_MEANINGS,
  ADMIN_MACRO_REMOTE,
  adminMacroCopy,
  adminMutationHeaders,
  blankAdminMacroEvent,
  adminEventKey,
  adminEventLabel,
  adminFormatDateTime,
  adminValidationErrors,
  normalizeAdminEventForList,
  adminResponseJson,
} from "../features/admin-macro-events/adminMacroModel.js";

export function AdminField({ label, children }) {
  return (
    <label className="admin-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function AdminPublishStatus({ status, copy, language }) {
  if (!status) return null;
  const missing = Array.isArray(status.missingManualEvents) ? status.missingManualEvents : [];
  const labelFor = (event) => (language === "en" ? event.labelEn : event.labelZh) || event.label || event.seriesId;
  return (
    <section className="admin-publish-status" aria-label={copy.publishStatus}>
      <div>
        <small>{copy.publishStatus}</small>
        <strong className={status.ok ? "macro-up" : "macro-down"}>{status.ok ? copy.readyToPublish : `${missing.length} ${copy.missingEvents}`}</strong>
      </div>
      <dl>
        <div><dt>{copy.manualEvents}</dt><dd>{status.manualEventCount ?? 0}</dd></div>
        <div><dt>{copy.publishedEvents}</dt><dd>{status.publishedManualEventCount ?? 0}</dd></div>
        <div><dt>{copy.draftEvents}</dt><dd>{status.draftManualEventCount ?? 0}</dd></div>
        <div><dt>{copy.archivedEvents}</dt><dd>{status.archivedManualEventCount ?? 0}</dd></div>
        <div><dt>{copy.calendarGenerated}</dt><dd>{status.macroCalendarGeneratedAt ? freshnessLabel(status.macroCalendarGeneratedAt, language) : "N/A"}</dd></div>
      </dl>
      {missing.length ? (
        <ul>
          {missing.slice(0, 6).map((event) => (
            <li key={`${event.seriesId}-${event.date}`}>{event.date} / {labelFor(event)}</li>
          ))}
        </ul>
      ) : null}
      {status.calendarError ? <p>{status.calendarError}</p> : null}
    </section>
  );
}

export function AdminMacroEventsPage({ language, setLanguage, t }) {
  const copy = adminMacroCopy(t);
  const [payload, setPayload] = useState({ version: 1, updatedAt: null, events: [] });
  const [draft, setDraft] = useState(() => blankAdminMacroEvent(language));
  const [selectedKey, setSelectedKey] = useState("");
  const [apiState, setApiState] = useState("loading");
  const [message, setMessage] = useState("");
  const [publishStatus, setPublishStatus] = useState(null);
  const [busyAction, setBusyAction] = useState("");
  const [canonicalWriteAvailable, setCanonicalWriteAvailable] = useState(false);

  const loadPublishStatus = () => {
    if (ADMIN_MACRO_REMOTE) {
      setPublishStatus(null);
      return;
    }
    fetch(`${ADMIN_MACRO_API_BASE}/macro-calendar-status`, { cache: "no-store" })
      .then(adminResponseJson)
      .then((data) => setPublishStatus(data))
      .catch(() => setPublishStatus(null));
  };

  const loadEvents = () => {
    setApiState("loading");
    fetch(`${ADMIN_MACRO_API_BASE}/manual-macro-events`, { cache: "no-store" })
      .then(adminResponseJson)
      .then((data) => {
        const nextPayload = { version: 1, updatedAt: data.updatedAt || null, events: Array.isArray(data.events) ? data.events : [] };
        const writable = Boolean(data.canonicalWriteAvailable);
        setPayload(nextPayload);
        setCanonicalWriteAvailable(writable);
        const first = nextPayload.events[0] || blankAdminMacroEvent(language);
        setDraft({ ...first });
        setSelectedKey(nextPayload.events[0] ? adminEventKey(first) : "");
        setApiState("connected");
        setMessage(writable ? copy.loaded : (copy.readOnly || "Supabase 规范源未配置；当前仓库快照只读。"));
        loadPublishStatus();
      })
      .catch((error) => {
        setApiState("disconnected");
        setMessage(error.message);
      });
  };

  const runAdminCommand = (path, successMessage) => {
    setBusyAction(path);
    fetch(`${ADMIN_MACRO_API_BASE}/${path}`, {
      method: "POST",
      headers: adminMutationHeaders(),
    })
      .then(adminResponseJson)
      .then((data) => {
        setApiState("connected");
        setPublishStatus(data.status || data);
        setMessage(successMessage);
      })
      .catch((error) => {
        const networkIssue = error.message.includes("Failed to fetch") || error.message.includes("NetworkError");
        setApiState(networkIssue ? "disconnected" : "connected");
        setMessage(error.message);
      })
      .finally(() => setBusyAction(""));
  };

  useEffect(() => {
    loadEvents();
    replaceHashState("admin/macro-events", {});
  }, []);

  const validationErrors = useMemo(() => adminValidationErrors(draft, copy), [draft, copy]);
  const hasErrors = validationErrors.length > 0;
  const releaseTime = draft.releaseTimeUtc || "";
  const beijingDate = releaseTime ? dateKeyInTimeZone(releaseTime, "Asia/Shanghai") : draft.date;
  const newYorkDate = releaseTime ? dateKeyInTimeZone(releaseTime, "America/New_York") : draft.date;
  const selectedIndex = payload.events.findIndex((event) => adminEventKey(event) === selectedKey);
  const canWrite = apiState === "connected" && canonicalWriteAvailable && !busyAction;

  const updateDraft = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const selectEvent = (event) => {
    setSelectedKey(adminEventKey(event));
    setDraft({ ...event });
    setMessage("");
  };
  const newEvent = () => {
    const event = blankAdminMacroEvent(language);
    setSelectedKey("");
    setDraft(event);
    setMessage("");
  };
  const duplicateEvent = () => {
    const dateSuffix = String(draft.date || "").replaceAll("-", "");
    setSelectedKey("");
    setDraft({ ...draft, status: "draft", seriesId: `${draft.seriesId || "MANUAL_EVENT"}_COPY_${dateSuffix}` });
  };
  const updateEventList = () => {
    if (hasErrors) return;
    const normalized = normalizeAdminEventForList(draft);
    setPayload((current) => {
      const events = [...current.events];
      if (selectedIndex >= 0) events[selectedIndex] = normalized;
      else events.unshift(normalized);
      return { ...current, events };
    });
    setSelectedKey(adminEventKey(normalized));
    setDraft(normalized);
    setMessage(copy.draftSaved);
  };
  const deleteEvent = () => {
    setPayload((current) => ({ ...current, events: current.events.filter((event) => adminEventKey(event) !== selectedKey) }));
    newEvent();
  };
  const saveAll = () => {
    if (!canonicalWriteAvailable) {
      setMessage(copy.readOnly || "Supabase 规范源未配置；当前仓库快照只读。");
      return;
    }
    setBusyAction("save");
    fetch(`${ADMIN_MACRO_API_BASE}/manual-macro-events`, {
      method: "PUT",
      headers: adminMutationHeaders({ json: true }),
      body: JSON.stringify({ version: 1, events: payload.events }),
    })
      .then(adminResponseJson)
      .then((data) => {
        setPayload(data);
        setApiState("connected");
        setMessage(ADMIN_MACRO_REMOTE ? copy.savedQueued : copy.saved);
        loadPublishStatus();
      })
      .catch((error) => {
        const networkIssue = error.message.includes("Failed to fetch") || error.message.includes("NetworkError");
        setApiState(networkIssue ? "disconnected" : "connected");
        setMessage(error.message);
      })
      .finally(() => setBusyAction(""));
  };

  return (
    <main className="app-page admin-page">
      <header className="app-header">
        <div className="title-block">
          <p className="eyebrow">{copy.eyebrow}</p>
          <h1>{copy.title}</h1>
          <p>{copy.subtitle}</p>
          <PageNav page="macroAdmin" t={t} />
        </div>
        <div className="freshness-block">
          <LanguageToggle language={language} onChange={setLanguage} t={t} />
          <CacheStatus label={copy.api} tooltip={copy.localOnly} />
          <strong className={apiState === "connected" ? "macro-up" : "macro-down"}>
            {apiState === "connected" ? copy.connected : copy.disconnected}
          </strong>
          <small>{message || copy.startApi}</small>
        </div>
      </header>

      <section className="admin-toolbar" aria-label={copy.editor}>
        <button type="button" onClick={loadEvents}>{copy.reload}</button>
        <button type="button" onClick={newEvent} disabled={!canWrite}>{copy.newEvent}</button>
        <button type="button" onClick={duplicateEvent} disabled={!canWrite}>{copy.duplicate}</button>
        <button type="button" onClick={deleteEvent} disabled={!selectedKey || !canWrite}>{copy.delete}</button>
        {!ADMIN_MACRO_REMOTE ? (
          <>
            <button type="button" onClick={() => runAdminCommand("validate-macro-events", copy.validationPassed)} disabled={apiState !== "connected" || Boolean(busyAction)}>{busyAction === "validate-macro-events" ? copy.publishing : copy.validate}</button>
            <button type="button" onClick={() => runAdminCommand("publish-macro-calendar", copy.publishPassed)} disabled={!canWrite}>{busyAction === "publish-macro-calendar" ? copy.publishing : copy.publish}</button>
          </>
        ) : null}
        <button type="button" className="admin-primary-action" onClick={saveAll} disabled={!canWrite}>{busyAction === "save" ? copy.publishing : copy.saveAll}</button>
      </section>

      <div className="admin-macro-layout">
        <aside className="admin-event-list" aria-label={copy.eventList}>
          <div className="macro-section-heading">
            <div>
              <p>{copy.api}</p>
              <h2>{copy.eventList}</h2>
            </div>
            <span>{payload.events.length}</span>
          </div>
          {payload.events.length ? payload.events.map((event) => (
            <button
              type="button"
              className={adminEventKey(event) === selectedKey ? "is-selected" : ""}
              onClick={() => selectEvent(event)}
              key={adminEventKey(event)}
            >
              <strong>{adminEventLabel(event, language)}</strong>
              <span>{event.date} / {event.category}</span>
              <em>{event.status || "published"}</em>
            </button>
          )) : <p className="admin-empty">{copy.empty}</p>}
        </aside>

        <section className="admin-editor" aria-label={copy.editor}>
          <div className="macro-section-heading">
            <div>
              <p>{copy.editor}</p>
              <h2>{adminEventLabel(draft, language)}</h2>
            </div>
            <button type="button" onClick={updateEventList} disabled={hasErrors || !canWrite}>{copy.saveDraft}</button>
          </div>

          {hasErrors ? (
            <div className="admin-validation">
              {validationErrors.map((error) => <span key={error}>{error}</span>)}
            </div>
          ) : null}

          <div className="admin-form-grid">
            <AdminField label={copy.fields.status}>
              <select value={draft.status || "published"} onChange={(event) => updateDraft("status", event.target.value)}>
                {copy.statusOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
              </select>
            </AdminField>
            <AdminField label={copy.fields.date}>
              <input type="date" value={draft.date || ""} onChange={(event) => updateDraft("date", event.target.value)} />
            </AdminField>
            <AdminField label={copy.fields.seriesId}>
              <input value={draft.seriesId || ""} onChange={(event) => updateDraft("seriesId", event.target.value.toUpperCase())} />
            </AdminField>
            <AdminField label={copy.fields.category}>
              <select value={draft.category || "liquidity"} onChange={(event) => updateDraft("category", event.target.value)}>
                {ADMIN_MACRO_CATEGORIES.map((category) => <option value={category} key={category}>{macroCategoryLabel(category, t)}</option>)}
              </select>
            </AdminField>
            <AdminField label={copy.fields.labelZh}>
              <input value={draft.labelZh || ""} onChange={(event) => updateDraft("labelZh", event.target.value)} />
            </AdminField>
            <AdminField label={copy.fields.labelEn}>
              <input value={draft.labelEn || ""} onChange={(event) => updateDraft("labelEn", event.target.value)} />
            </AdminField>
            <AdminField label={copy.fields.role}>
              <input value={draft.role || ""} onChange={(event) => updateDraft("role", event.target.value)} />
            </AdminField>
            <AdminField label={copy.fields.unit}>
              <input value={draft.unit || ""} onChange={(event) => updateDraft("unit", event.target.value)} />
            </AdminField>
            <AdminField label={copy.fields.source}>
              <input value={draft.source || ""} onChange={(event) => updateDraft("source", event.target.value)} />
            </AdminField>
            <AdminField label={copy.fields.sourceUrl}>
              <input value={draft.sourceUrl || ""} onChange={(event) => updateDraft("sourceUrl", event.target.value)} />
            </AdminField>
            <AdminField label={copy.fields.dateMeaning}>
              <select value={draft.dateMeaning || "scheduled_beijing_date"} onChange={(event) => updateDraft("dateMeaning", event.target.value)}>
                {ADMIN_MACRO_DATE_MEANINGS.map((value) => <option value={value} key={value}>{macroDateMeaningLabel(value, t)}</option>)}
              </select>
            </AdminField>
            <AdminField label={copy.fields.releaseTimeUtc}>
              <input placeholder="2026-07-19T19:00:00Z" value={draft.releaseTimeUtc || ""} onChange={(event) => updateDraft("releaseTimeUtc", event.target.value)} />
            </AdminField>
            <AdminField label={copy.fields.actual}>
              <input inputMode="decimal" value={draft.actual ?? ""} onChange={(event) => updateDraft("actual", event.target.value)} />
            </AdminField>
            <AdminField label={copy.fields.previous}>
              <input inputMode="decimal" value={draft.previous ?? ""} onChange={(event) => updateDraft("previous", event.target.value)} />
            </AdminField>
            <AdminField label={copy.fields.forecast}>
              <input inputMode="decimal" value={draft.forecast ?? ""} onChange={(event) => updateDraft("forecast", event.target.value)} />
            </AdminField>
            <AdminField label={copy.fields.note}>
              <textarea value={draft.note || ""} onChange={(event) => updateDraft("note", event.target.value)} rows={5} />
            </AdminField>
          </div>
        </section>

        <aside className="admin-preview" aria-label={copy.preview}>
          <div className="macro-section-heading">
            <div>
              <p>{copy.preview}</p>
              <h2>{copy.displayDate}</h2>
            </div>
          </div>
          <dl>
            <div><dt>{copy.displayDate}</dt><dd>{draft.date || "N/A"}</dd></div>
            <div><dt>{copy.beijingDate}</dt><dd>{beijingDate || "N/A"}</dd></div>
            <div><dt>{copy.newYorkDate}</dt><dd>{newYorkDate || "N/A"}</dd></div>
            <div><dt>UTC</dt><dd>{releaseTime || "N/A"}</dd></div>
            <div><dt>UTC+8</dt><dd>{releaseTime ? adminFormatDateTime(releaseTime, "Asia/Shanghai", language) : "N/A"}</dd></div>
            <div><dt>ET</dt><dd>{releaseTime ? adminFormatDateTime(releaseTime, "America/New_York", language) : "N/A"}</dd></div>
          </dl>
          <AdminPublishStatus status={publishStatus} copy={copy} language={language} />
          <p>{releaseTime ? copy.localOnly : copy.noReleaseTime}</p>
        </aside>
      </div>
    </main>
  );
}
