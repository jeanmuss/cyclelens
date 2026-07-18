export const PUBLIC_ROUTE_LOADERS = Object.freeze({
  crypto: () => import("../../routes/CryptoRoute.js"),
  cryptoLiquidity: () => import("../../routes/CryptoLiquidityRoute.js"),
  macro: () => import("../../routes/MacroRoute.js"),
  equity: () => import("../../routes/EquityRoute.js"),
  marketClock: () => import("../../routes/MarketClockRoute.js"),
  chipChain: () => import("../../routes/ChipChainRoute.js"),
  robotChain: () => import("../../routes/RobotChainRoute.js"),
});
