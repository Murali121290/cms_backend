import { useEffect, useState } from "react";
import { formatDuration, secondsSince } from "./lockLabels";

/** Live "1h 02m" timer counting from `since` (ISO). Ticks every second. */
export function LockElapsed({ since, className }: { since: string | null | undefined; className?: string }) {
  const [secs, setSecs] = useState(() => secondsSince(since));
  useEffect(() => {
    setSecs(secondsSince(since));
    if (!since) return;
    const t = window.setInterval(() => setSecs(secondsSince(since)), 1000);
    return () => window.clearInterval(t);
  }, [since]);
  if (!since) return null;
  return <span className={`tabular-nums ${className ?? ""}`}>{formatDuration(secs)}</span>;
}
