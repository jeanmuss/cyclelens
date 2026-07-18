import { createElement } from "react";
import { RobotChainPage } from "../pages/RobotChainPage.jsx";
import { RouteRuntime } from "../pages/RouteRuntime.jsx";

export default function RobotChainRoute() {
  return createElement(RouteRuntime, { PageComponent: RobotChainPage, routeId: "robotChain" });
}
