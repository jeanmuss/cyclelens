import { useEffect, useMemo, useRef, useState } from "react";
import { appUrl } from "./data.js";
import {
  initialLiveData,
  manifestFreshness,
  manifestVersion,
  normalizePollInterval,
  versionedDataUrl,
} from "./liveDataPolicy.js";

const MANIFEST_PATH = "data/data-manifest.json";

function loadError(response) {
  const error = new Error("data-file");
  error.status = response.status;
  return error;
}

function publicError(error) {
  return { status: error?.status, message: error?.message || "data-file" };
}

export function useLiveData(definitions, { enabled = true } = {}) {
  const [data, setData] = useState(() => initialLiveData(definitions));
  const [freshness, setFreshness] = useState(() => initialLiveData(definitions));
  const [error, setError] = useState(null);
  const dataRef = useRef(data);
  const requiredFailuresRef = useRef(new Map());

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    let timer = null;
    let manifestRequestRunning = false;
    let pollIntervalMs = Math.min(...definitions.map((item) => normalizePollInterval(item.pollIntervalMs)));
    const loadedVersions = new Map();
    const controller = new AbortController();

    const publishRequiredError = () => {
      const firstFailure = requiredFailuresRef.current.values().next().value;
      setError(firstFailure || null);
    };

    const loadDataset = async (definition, version) => {
      try {
        const response = await fetch(versionedDataUrl(appUrl(definition.path), version), {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw loadError(response);
        const payload = await response.json();
        if (!active) return false;

        setData((current) => {
          const next = { ...current, [definition.id]: payload };
          dataRef.current = next;
          return next;
        });
        if (version) loadedVersions.set(definition.id, version);
        if (definition.required !== false) {
          requiredFailuresRef.current.delete(definition.id);
          publishRequiredError();
        }
        return true;
      } catch (caught) {
        if (!active || caught?.name === "AbortError") return false;
        if (definition.required !== false && !dataRef.current[definition.id]) {
          requiredFailuresRef.current.set(definition.id, publicError(caught));
          publishRequiredError();
        }
        return false;
      }
    };

    const refreshManifest = async () => {
      if (!active || manifestRequestRunning) return;
      manifestRequestRunning = true;
      try {
        const response = await fetch(versionedDataUrl(appUrl(MANIFEST_PATH), Date.now()), {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw loadError(response);
        const manifest = await response.json();
        const manifestDatasets = manifest?.datasets || {};
        const clientCheckedAt = new Date().toISOString();
        setFreshness((current) => Object.fromEntries(definitions.map((definition) => [
          definition.id,
          manifestFreshness(manifestDatasets[definition.id], clientCheckedAt) || current[definition.id],
        ])));
        const configuredIntervals = definitions.map((definition) => {
          const manifestInterval = manifestDatasets[definition.id]?.pollIntervalMs;
          return normalizePollInterval(manifestInterval, normalizePollInterval(definition.pollIntervalMs));
        });
        pollIntervalMs = Math.min(...configuredIntervals);

        await Promise.all(definitions.map(async (definition) => {
          const entry = manifestDatasets[definition.id];
          const version = manifestVersion(entry?.version);
          const loadedVersion = loadedVersions.get(definition.id);
          if (!dataRef.current[definition.id]) {
            await loadDataset(definition, version);
          } else if (version && loadedVersion && version !== loadedVersion) {
            await loadDataset(definition, version);
          } else if (version && !loadedVersion) {
            loadedVersions.set(definition.id, version);
          }
        }));
      } catch (caught) {
        if (!active || caught?.name === "AbortError") return;
        await Promise.all(definitions
          .filter((definition) => !dataRef.current[definition.id])
          .map((definition) => loadDataset(definition)));
      } finally {
        manifestRequestRunning = false;
      }
    };

    const scheduleNextCheck = () => {
      if (!active) return;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        await refreshManifest();
        scheduleNextCheck();
      }, pollIntervalMs);
    };

    const checkWhenVisible = async () => {
      if (document.visibilityState !== "visible") return;
      await refreshManifest();
      scheduleNextCheck();
    };

    const start = async () => {
      await refreshManifest();
      scheduleNextCheck();
    };

    void start();
    document.addEventListener("visibilitychange", checkWhenVisible);

    return () => {
      active = false;
      controller.abort();
      if (timer) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", checkWhenVisible);
      requiredFailuresRef.current.clear();
    };
  }, [definitions, enabled]);

  const loading = useMemo(
    () => enabled && definitions.some((definition) => definition.required !== false && !data[definition.id]),
    [data, definitions, enabled],
  );

  return { data, error, loading, freshness };
}
