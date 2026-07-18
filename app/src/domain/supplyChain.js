import { isChipSampleAsset } from "../chipData.js";

export function chipHeatClass(value) {
  if (!Number.isFinite(value)) return "chip-heat-na";
  if (value >= 8) return "chip-heat-up-4";
  if (value >= 4) return "chip-heat-up-3";
  if (value >= 1.5) return "chip-heat-up-2";
  if (value >= 0) return "chip-heat-up-1";
  if (value > -1.5) return "chip-heat-down-1";
  if (value > -4) return "chip-heat-down-2";
  if (value > -8) return "chip-heat-down-3";
  return "chip-heat-down-4";
}

export function hasRealCachedPricePath(asset) {
  return !isChipSampleAsset(asset);
}

export function chipSparkValues(asset, range) {
  if (!hasRealCachedPricePath(asset)) return [];
  return (asset?.pricePaths?.[range] || [])
    .map((point) => Number(point?.c ?? point?.close ?? point?.price ?? point))
    .filter(Number.isFinite);
}

export function chipSparkGeometry(values, width = 94, height = 28) {
  const numeric = values.filter(Number.isFinite);
  const min = Math.min(...numeric);
  const max = Math.max(...numeric);
  const spread = Math.max(1, max - min);
  const points = values.map((value, index) => {
    const x = values.length > 1 ? (index / (values.length - 1)) * width : 0;
    const y = height - ((value - min) / spread) * (height - 6) - 3;
    return { x, y };
  });
  return {
    points: points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" "),
    end: points[points.length - 1] || { x: 0, y: height / 2 },
    midY: height / 2,
  };
}

export function equityMoveClass(value) {
  if (!Number.isFinite(Number(value)) || Number(value) === 0) return "";
  return Number(value) > 0 ? "positive" : "negative";
}

export function chipTreemapWeight(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.abs(numeric) + 0.25;
}

export function splitChipTreemapItems(items, rect) {
  if (!items.length) return [];
  if (items.length === 1) return [{ ...items[0], rect }];
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 0) return [];
  const half = total / 2;
  let running = 0;
  let splitIndex = 1;
  let bestDistance = Infinity;
  for (let index = 0; index < items.length - 1; index += 1) {
    running += items[index].weight;
    const distance = Math.abs(half - running);
    if (distance < bestDistance) {
      bestDistance = distance;
      splitIndex = index + 1;
    }
  }
  const first = items.slice(0, splitIndex);
  const second = items.slice(splitIndex);
  const firstWeight = first.reduce((sum, item) => sum + item.weight, 0);
  const ratio = firstWeight / total;
  if (rect.width >= rect.height) {
    const firstWidth = rect.width * ratio;
    return [
      ...splitChipTreemapItems(first, { ...rect, width: firstWidth }),
      ...splitChipTreemapItems(second, { ...rect, x: rect.x + firstWidth, width: rect.width - firstWidth }),
    ];
  }
  const firstHeight = rect.height * ratio;
  return [
    ...splitChipTreemapItems(first, { ...rect, height: firstHeight }),
    ...splitChipTreemapItems(second, { ...rect, y: rect.y + firstHeight, height: rect.height - firstHeight }),
  ];
}

export function chipTreemapTiles(movers, range) {
  const items = movers
    .map((asset) => {
      const value = Number(asset.returns?.[range]);
      return { asset, value, weight: chipTreemapWeight(value) };
    })
    .filter((item) => item.weight > 0)
    .sort((a, b) => b.weight - a.weight || b.value - a.value || a.asset.symbol.localeCompare(b.asset.symbol));
  return splitChipTreemapItems(items, { x: 0, y: 0, width: 100, height: 100 });
}

export function chipTreemapSymbol(symbol) {
  return String(symbol || "").replace(/\.(KS|KQ)$/i, "");
}

export function chipTreemapTextClass(value) {
  const magnitude = Math.abs(Number(value));
  if (!Number.isFinite(magnitude)) return "chip-move-text-1";
  if (magnitude >= 7) return "chip-move-text-5";
  if (magnitude >= 4) return "chip-move-text-4";
  if (magnitude >= 2) return "chip-move-text-3";
  if (magnitude >= 0.8) return "chip-move-text-2";
  return "chip-move-text-1";
}
