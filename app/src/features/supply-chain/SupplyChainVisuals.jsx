import { useMemo } from "react";
import { formatPct } from "../../data.js";
import { DataState } from "../../shared/components/DataState.jsx";
import {
  chipHeatClass,
  chipSparkValues,
  chipSparkGeometry,
  chipTreemapTiles,
  chipTreemapSymbol,
  chipTreemapTextClass,
} from "../../domain/supplyChain.js";

export function ChipSparkline({ asset, range }) {
  const returnPct = Number(asset?.returns?.[range]);
  const values = chipSparkValues(asset, range);
  if (values.length < 2) {
    return (
      <span className="chip-sparkline chip-sparkline-empty" title="No real cached price path" aria-hidden="true">
        <span />
      </span>
    );
  }
  const geometry = chipSparkGeometry(values);
  return (
    <span className={`chip-sparkline ${returnPct >= 0 ? "positive" : "negative"}`} aria-hidden="true">
      <svg viewBox="0 0 94 28" focusable="false">
        <polyline className="chip-sparkline-mid" points={`0,${geometry.midY} 94,${geometry.midY}`} />
        <polyline className="chip-sparkline-line" points={geometry.points} />
        <circle className="chip-sparkline-dot" cx={geometry.end.x} cy={geometry.end.y} r="2.2" />
      </svg>
    </span>
  );
}

export function ChainTreemapSummary({ movers, range, selectedSymbol, onSelect, copy, className = "" }) {
  const tiles = useMemo(() => chipTreemapTiles(movers, range), [movers, range]);
  if (!tiles.length) {
    return (
      <section className={`chip-hotspot-summary chip-treemap-summary ${className}`.trim()} aria-label={copy.latest}>
        <DataState variant="empty" className="chip-treemap-empty">{copy.noRows}</DataState>
      </section>
    );
  }
  const selectable = typeof onSelect === "function";
  return (
    <section className={`chip-hotspot-summary chip-treemap-summary ${className}`.trim()} aria-label={copy.latest}>
      {tiles.map(({ asset, value, rect }) => {
        const area = rect.width * rect.height;
        const tinyTile = rect.width < 5 || rect.height < 5 || area < 170;
        const compactTile = !tinyTile && (rect.height < 16 || area < 300 || (rect.width < 10 && area < 360));
        const densityClass = tinyTile ? "is-tiny" : compactTile ? "is-compact" : "";
        const shapeClass = rect.width < 6 || rect.height < 6 ? "is-narrow" : "";
        const TileElement = selectable ? "button" : "div";
        const interactiveProps = selectable
          ? {
              type: "button",
              onClick: () => onSelect(asset.symbol),
              "aria-pressed": selectedSymbol === asset.symbol,
            }
          : {};
        return (
          <TileElement
            {...interactiveProps}
            className={`chip-treemap-tile ${chipHeatClass(value)} ${chipTreemapTextClass(value)} ${densityClass} ${shapeClass} ${selectable ? "" : "is-static"} ${selectedSymbol === asset.symbol ? "is-selected" : ""}`}
            key={asset.symbol}
            aria-label={`${asset.symbol} ${asset.name} ${formatPct(value, 1)}`}
            title={`${asset.symbol} ${asset.name} ${formatPct(value, 1)}`}
            style={{
              left: `${rect.x}%`,
              top: `${rect.y}%`,
              width: `${rect.width}%`,
              height: `${rect.height}%`,
            }}
          >
            <span className="chip-treemap-label">
              <strong>{chipTreemapSymbol(asset.symbol)}</strong>
            </span>
            <em>{formatPct(value, 1)}</em>
          </TileElement>
        );
      })}
    </section>
  );
}
