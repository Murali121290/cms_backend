import { useEffect, useState } from "react";

/** Current time, re-rendered every `intervalMs` (for "updated Xs ago" and the schedule today line). */
export function useNow(intervalMs = 5000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}
