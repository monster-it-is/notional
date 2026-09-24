import { cn } from "../../lib/cn.ts";
import { landingContainer } from "./LandingSection.tsx";

const ITEMS = [
  ["Virtual funds", "USDT that exists only inside the simulator."],
  ["Live market data", "Mark, index, bid, ask, and funding."],
  ["Futures mechanics", "Orders, leverage, margin, funding, liquidation."],
  ["No real capital", "Nothing on this desk moves a real asset."],
] as const;

export function ValueStrip() {
  return (
    <section aria-labelledby="value-strip-title" className="border-t border-border bg-surface-subtle">
      <h2 className="sr-only" id="value-strip-title">
        What this desk provides
      </h2>
      <ul className={`${landingContainer} grid grid-cols-2 lg:grid-cols-4`}>
        {ITEMS.map(([title, body], index) => (
          <li
            key={title}
            className={cn(
              "border-border py-3 sm:py-5",
              index % 2 === 1 && "border-l pl-4 min-[360px]:pl-5 sm:pl-6",
              index > 1 && "border-t lg:border-t-0",
              index > 0 && "lg:border-l lg:pl-6",
            )}
          >
            <p className="font-numeric text-[11px] text-muted">{String(index + 1).padStart(2, "0")}</p>
            <p className="mt-1 text-sm font-medium text-foreground">{title}</p>
            <p className="mt-1 text-xs leading-snug text-secondary sm:text-sm sm:leading-relaxed">{body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
