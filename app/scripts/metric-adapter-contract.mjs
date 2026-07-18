export const METRIC_ADAPTER_STAGES = Object.freeze([
  "fetch",
  "normalize",
  "validate",
  "persist",
  "project",
]);

export function defineMetricAdapter(definition) {
  if (!definition?.id) throw new Error("Metric adapter id is required");
  for (const stage of METRIC_ADAPTER_STAGES) {
    if (typeof definition[stage] !== "function") throw new Error(`${definition.id}: ${stage} stage is required`);
  }
  return Object.freeze({ ...definition });
}

export async function runMetricAdapter(adapter, context = {}) {
  const fetched = await adapter.fetch(context);
  const normalized = await adapter.normalize(fetched, context);
  const validated = await adapter.validate(normalized, context);
  const persisted = await adapter.persist(validated, context);
  const projected = await adapter.project(persisted, context);
  return { fetched, normalized, validated, persisted, projected };
}

export function createSourceTransportAdapter(transport) {
  const invoke = (stage, value, context) => {
    if (typeof context?.[stage] !== "function") throw new Error(`${transport}: ${stage} handler is required`);
    return context[stage](value, { transport });
  };
  return defineMetricAdapter({
    id: `source:${transport}`,
    transport,
    productionDefault: transport !== "legacy_unofficial",
    fetch(context) { return invoke("fetch", undefined, context); },
    normalize(value, context) { return invoke("normalize", value, context); },
    validate(value, context) { return invoke("validate", value, context); },
    persist(value, context) { return invoke("persist", value, context); },
    project(value, context) { return invoke("project", value, context); },
  });
}

export const SOURCE_TRANSPORT_ADAPTERS = Object.freeze([
  "official_json_api",
  "public_json_api",
  "licensed_json_api",
  "official_csv",
  "official_html",
  "official_disclosure",
  "legacy_unofficial",
].map(createSourceTransportAdapter));
