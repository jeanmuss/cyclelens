import { createElement } from "react";
import { CryptoCyclePage } from "../pages/CryptoPage.jsx";
import { RouteRuntime } from "../pages/RouteRuntime.jsx";

export default function CryptoRoute() {
  return createElement(RouteRuntime, { PageComponent: CryptoCyclePage, routeId: "crypto" });
}
