import { cn } from "../../lib/cn.ts";
import { useTickFlash } from "./use-tick-flash.ts";

export function TickValue({
  value,
  display,
  className,
  live = false,
}: {
  value: string | undefined;
  display: string;
  className?: string;
  live?: boolean;
}) {
  const flash = useTickFlash(value, live);

  return (
    <span
      className={cn(
        "tick-value",
        flash === "up" && "tick-up",
        flash === "down" && "tick-down",
        className,
      )}
    >
      {display}
    </span>
  );
}
