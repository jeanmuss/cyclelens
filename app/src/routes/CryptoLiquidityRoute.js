import { createElement } from "react";
import { CryptoLiquidityPage } from "../pages/CryptoLiquidityPage.jsx";
import { RouteRuntime } from "../pages/RouteRuntime.jsx";

export default function CryptoLiquidityRoute() {
  return createElement(RouteRuntime, { PageComponent: CryptoLiquidityPage, routeId: "cryptoLiquidity" });
}
