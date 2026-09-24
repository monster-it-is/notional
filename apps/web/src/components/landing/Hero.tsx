import { cn } from "../../lib/cn.ts";
import {
  Eyebrow,
  exploreLinkClass,
  landingContainer,
  sectionBody,
} from "./LandingSection.tsx";
import { HeroTradingPreview } from "./HeroTradingPreview.tsx";
import { StartPaperTradingLink } from "./PaperTradeLink.tsx";

const FACTS = [
  ["Virtual USDT", "A simulator balance. No wallet and no real transfer."],
  ["Live market data", "Mark, index, bid, ask, and funding from Notional."],
  ["Long and short", "Practice both directions with market and limit orders."],
  ["Leverage and margin", "See how 1× to 100× changes exposure and risk."],
] as const;

export function Hero() {
  return (
    <div className={landingContainer}>
      <div className="grid gap-8 pt-8 pb-10 sm:gap-10 sm:pt-14 sm:pb-16 xl:grid-cols-2 xl:items-center xl:gap-12 xl:py-20">
        <div className="min-w-0">
          <Eyebrow index="01" label="Practice" />
          <h1 className="mt-3 max-w-[12em] font-heading text-[1.75rem] font-semibold leading-[1.15] tracking-tight text-balance text-foreground sm:text-4xl lg:text-5xl">
            Practice futures before the capital is real.
          </h1>
          <p className={sectionBody}>
            Notional is a simulated desk for crypto perpetual futures. Trade virtual USDT, follow
            live market prices, and manage long or short positions with leverage. No real assets
            are traded.
          </p>
          <div className="mt-5 flex flex-col items-stretch gap-1 sm:mt-6 sm:flex-row sm:items-center sm:gap-3">
            <StartPaperTradingLink />
            <a className={exploreLinkClass} href="#how-it-works">
              Explore how it works
            </a>
          </div>
          <HeroFacts className="mt-8 hidden xl:grid" />
        </div>
        <div className="min-w-0">
          <HeroTradingPreview />
        </div>
        <HeroFacts className="xl:hidden" />
      </div>
    </div>
  );
}

function HeroFacts({ className }: { className?: string }) {
  return (
    <ul
      className={cn(
        "grid grid-cols-1 gap-px border border-border bg-border min-[360px]:grid-cols-2",
        "xl:border-0 xl:bg-transparent xl:gap-x-8 xl:gap-y-5",
        className,
      )}
    >
      {FACTS.map(([title, body]) => (
        <li key={title} className="bg-background px-3 py-3 xl:bg-transparent xl:px-0 xl:py-0">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="mt-1 text-xs leading-snug text-secondary xl:text-sm xl:leading-relaxed">
            {body}
          </p>
        </li>
      ))}
    </ul>
  );
}
