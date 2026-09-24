import { useEffect, useState } from "react";

import { cn } from "../../lib/cn.ts";
import {
  isLandingFeedLive,
  landingFeedStatusLabel,
} from "./landing-feed-state.ts";
import { useLandingMarket } from "./use-landing-market.ts";

export function FeedStatus() {
  const { feedState } = useLandingMarket();
  const live = isLandingFeedLive(feedState);

  return (
    <p className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-secondary">
      <span
        aria-hidden="true"
        className={cn("h-1.5 w-1.5 shrink-0", live ? "status-pulse bg-accent" : "bg-muted")}
      />
      {landingFeedStatusLabel(feedState)}
    </p>
  );
}

export function SessionClock({ className }: { className?: string }) {
  const time = useSessionClock();

  return (
    <time className={cn("font-numeric text-[11px] text-secondary", className)} dateTime={time}>
      {time}
    </time>
  );
}

const SAMPLE_ROWS = [
  ["Sample mark", "60,420.00"],
  ["Sample move", "+0.70%"],
  ["Sample uPnL", "+42.00"],
  ["Account", "Not yours"],
] as const;

export function SampleTape({ className }: { className?: string }) {
  const active = useSampleStep(SAMPLE_ROWS.length);

  return (
    <div className={cn("bg-surface-subtle px-3 py-2", className)}>
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-secondary">
        Simulation tape
      </p>
      <ul className="mt-2 space-y-1">
        {SAMPLE_ROWS.map(([label, value], index) => (
          <li
            key={label}
            className={cn(
              "grid grid-cols-[1fr_auto] gap-2 border-l-2 py-1 pl-2 font-numeric text-[11px]",
              index === active ? "border-accent text-foreground" : "border-transparent text-secondary",
            )}
          >
            <span>{label}</span>
            <span>{value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function useSessionClock(): string {
  const [time, setTime] = useState(() => formatClock(new Date()));

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTime(formatClock(new Date()));
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  return time;
}

function useSampleStep(length: number): number {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
      return;
    }

    const timer = window.setInterval(() => {
      setStep((current) => (current + 1) % length);
    }, 2800);

    return () => {
      window.clearInterval(timer);
    };
  }, [length]);

  return step;
}

function formatClock(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}
