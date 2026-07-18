import { createElement } from "react";
import { EquityMacroPage } from "../pages/EquityPage.jsx";
import { RouteRuntime } from "../pages/RouteRuntime.jsx";

export default function EquityRoute() {
  return createElement(RouteRuntime, { PageComponent: EquityMacroPage, routeId: "equity" });
}
