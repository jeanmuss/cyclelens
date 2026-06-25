# Prototype Instructions

Run the local server yourself and open the preview in the in-app browser. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## Durable Design Decisions

- Match the reference Bitcoin cycle map: warm off-white canvas, black square grid, compact red/green heat cells, yellow halving markers, and blue time labels.
- Use semantic HTML tables for both views. Do not replace the tables with canvas, SVG, or a charting dependency.
- The product has two working views: a four-asset monthly rotation table and a single-asset year-by-month cycle matrix.
- Keep all market-data credentials out of the browser. The frontend reads only the cached `public/data/market-monthly.json` artifact.
- Missing pre-launch history must display as `N/A`; never fabricate historical returns.
- Keep the page title size identical across rotation and single-asset views.
- The cycle matrix shows at most the current year plus one future year; distant empty years add noise.
- Cached monthly rows include `high`, `low`, `highTime`, `lowTime`, `firstExtreme`, and `extremeMovePct`.
- Directional extreme move is `(second extreme - first extreme) / first extreme`: low-then-high is a positive potential gain; high-then-low is a negative potential loss. It is theoretical and must never be presented as realized performance.
