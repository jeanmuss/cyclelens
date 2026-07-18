export function cycleLabel(cycle, t) {
  return t.cycle[cycle?.className] || cycle?.label || "";
}

export function extremeMoveMeta(row, t) {
  const value = row?.extremeMovePct;
  if (!Number.isFinite(value)) return { label: t.extreme.unavailable, order: "", className: "" };
  const order = row?.firstExtreme === "low"
    ? t.extreme.lowToHigh
    : row?.firstExtreme === "high"
      ? t.extreme.highToLow
      : t.extreme.flat;
  if (value > 0) return { label: t.extreme.gain, order, className: "positive" };
  if (value < 0) return { label: t.extreme.loss, order, className: "negative" };
  return { label: t.extreme.move, order, className: "" };
}
