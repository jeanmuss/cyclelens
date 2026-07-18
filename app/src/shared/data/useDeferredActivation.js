import { useEffect, useState } from "react";

export function useDeferredActivation(active) {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (!active) {
      setEnabled(false);
      return undefined;
    }
    if (typeof window.requestIdleCallback === "function") {
      const idleId = window.requestIdleCallback(() => setEnabled(true), { timeout: 1_500 });
      return () => window.cancelIdleCallback(idleId);
    }
    const timeoutId = window.setTimeout(() => setEnabled(true), 100);
    return () => window.clearTimeout(timeoutId);
  }, [active]);

  return enabled;
}
