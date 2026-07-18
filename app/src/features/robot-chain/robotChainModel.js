export function robotAttributeLabel(attribute, copy) {
  return copy.attributeLabels?.[attribute] || attribute || "N/A";
}

export function robotCategoryRows(dataset) {
  const assetMap = dataset?.assets || {};
  return (dataset?.categories || []).map((category) => ({
    category,
    assets: (category.tickers || []).map((symbol) => assetMap[symbol]).filter(Boolean),
  })).filter((row) => row.assets.length);
}

export function robotTopMovers(rows, range) {
  const seen = new Set();
  return rows
    .flatMap((row) => row.assets)
    .filter((asset) => {
      if (seen.has(asset.symbol)) return false;
      seen.add(asset.symbol);
      return true;
    })
    .filter((asset) => Number.isFinite(Number(asset.returns?.[range])))
    .sort((a, b) => Number(b.returns?.[range]) - Number(a.returns?.[range]));
}
