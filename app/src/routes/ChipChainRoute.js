import { createElement } from "react";
import { ChipChainPage } from "../pages/ChipChainPage.jsx";
import { RouteRuntime } from "../pages/RouteRuntime.jsx";

export default function ChipChainRoute() {
  return createElement(RouteRuntime, { PageComponent: ChipChainPage, routeId: "chipChain" });
}
