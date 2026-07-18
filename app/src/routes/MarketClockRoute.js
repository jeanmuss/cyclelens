import { createElement } from "react";
import { MarketClockPage } from "../pages/MarketClockPage.jsx";
import { RouteRuntime } from "../pages/RouteRuntime.jsx";

export default function MarketClockRoute() {
  return createElement(RouteRuntime, { PageComponent: MarketClockPage, routeId: "marketClock" });
}
