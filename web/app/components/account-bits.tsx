// Buttons and the session countdown, shared by the back panel and the portfolio.
import { useEffect, useState } from "react";
import type { Session } from "../lib/backer.client";

export const btn =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-md px-5 text-[15px] font-medium transition-colors active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50";
export const primary = `${btn} bg-brass text-ink hover:bg-brass-hover`;
export const secondary = `${btn} bg-panel text-ink ring-1 ring-line hover:bg-panel-2`;
export const quiet = "min-h-11 px-2 text-[14px] text-muted underline decoration-current/30 underline-offset-2 hover:text-ink";

export function Countdown({ session, className = "text-gain" }: { session: Session; className?: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.ceil((session.expiresAt - now) / 1000));
  return (
    <p className={`font-mono text-[13px] tabular-nums ${className}`}>
      Unlocked, {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")} left
    </p>
  );
}
