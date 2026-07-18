import { createElement } from "react";
import { DashboardPage } from "../pages/DashboardPage.jsx";
import { RouteRuntime } from "../pages/RouteRuntime.jsx";

export default function DashboardRoute() {
  return createElement(RouteRuntime, { PageComponent: DashboardPage, routeId: "dashboard" });
}
