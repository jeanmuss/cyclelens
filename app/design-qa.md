# Design QA

## Evidence

- Source visual truth: `C:\Users\hovyf\Documents\cycle-map\.reference\original-screen.png`
- Implementation screenshots:
  - `C:\Users\hovyf\Documents\cycle-map\app\qa\extreme-positive.png`
  - `C:\Users\hovyf\Documents\cycle-map\app\qa\extreme-negative.png`
  - `C:\Users\hovyf\Documents\cycle-map\app\qa\extreme-mobile.png`
- Browser and viewports: Codex in-app browser at 1280 × 720 and 390 × 844 CSS pixels.
- Compared states: HYPE 2026-06 selected with a positive low-to-high extreme move; BTC 2026-06 selected with a negative high-to-low extreme move.
- Full-view comparison: the source and negative-direction implementation screenshot were opened together at original resolution. The year-by-month matrix, compact black grid, red/green heat cells, blue year column, yellow halving cells, separated cycle groups, total column, and cycle column retain the reference's visual grammar.
- Focused-region comparison: the 2026-06 tooltip and fixed detail band were inspected at original resolution in both positive and negative states. Labels, signs, colors, order text, prices, and percentages remain readable without overlap.

## Findings

- No actionable P0, P1, or P2 fidelity findings remain.
- P3: the source repository's custom display typeface is not bundled under a clearly reusable local license, so the implementation keeps its system font stack.
- Expected data limitation: Hyperliquid exposes HYPE 2024-11 monthly OHLC but no retained intramonth candles. That month's direction is displayed as `N/A` instead of being inferred.

## Required fidelity surfaces

1. Fonts and typography: the existing compact numeric hierarchy is preserved. Positive direction uses green emphasis; negative direction uses red emphasis.
2. Spacing and layout rhythm: the nine-field detail band remains aligned at desktop width and collapses to two columns on mobile without page overflow.
3. Colors and visual tokens: semantic return colors, black grid, warm neutral canvas, blue years, and yellow halving markers remain aligned with the reference.
4. Image quality and asset fidelity: the analytical interface requires no raster imagery or decorative assets; no placeholders or fabricated icons were introduced.
5. Copy and content: the metric now says `潜在最大收益 · 低点→高点` for positive results and `潜在最大亏损 · 高点→低点` for negative results. Unavailable order is stated explicitly.

## Patches since the previous QA pass

- Replaced the always-positive range formula with `(second extreme - first extreme) / first extreme`.
- Added `highTime`, `lowTime`, `firstExtreme`, `extremeMovePct`, and order resolution to cached monthly rows.
- Used daily candles for ordering and refined same-day collisions with hourly, then one-minute public candles.
- Added incremental updates so later runs request only the latest two months after the historical backfill.
- Updated the fixed detail band and hover tooltip to switch automatically between potential gain and potential loss.
- Added a no-inference state for the single HYPE launch month that lacks intramonth source history.

## Implementation checklist

- Positive low-to-high example: passed (`HYPE 2026-06`, `+46.36%`)
- Negative high-to-low example: passed (`BTC 2026-06`, `-20.19%`)
- Unavailable-order example: passed (`HYPE 2024-11`, `N/A`)
- Desktop and mobile responsive checks: passed
- Console errors and warnings: none
- Source and implementation compared together: passed

final result: passed
