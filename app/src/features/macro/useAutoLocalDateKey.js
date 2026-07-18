import { useEffect, useState } from "react";

import { localDateKey } from "./macroCalendarModel.js";

export function useAutoLocalDateKey() {
  const [todayKey, setTodayKey] = useState(localDateKey);

  useEffect(() => {
    const refreshTodayKey = () => {
      const nextKey = localDateKey();
      setTodayKey((current) => current === nextKey ? current : nextKey);
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refreshTodayKey();
    };

    refreshTodayKey();
    const interval = window.setInterval(refreshTodayKey, 60000);
    window.addEventListener("focus", refreshTodayKey);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshTodayKey);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  return todayKey;
}
