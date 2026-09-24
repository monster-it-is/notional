import { exploreLinkClass, landingContainer, landingSectionY } from "./LandingSection.tsx";
import { StartPaperTradingLink } from "./PaperTradeLink.tsx";

export function FinalCta() {
  return (
    <section aria-labelledby="final-cta-title" className="scroll-mt-24 border-t border-border">
      <div className={`${landingContainer} ${landingSectionY}`}>
        <div className="max-w-3xl border-l-2 border-accent pl-5 sm:pl-6">
          <p className="font-numeric text-[11px] uppercase tracking-[0.16em] text-secondary">
            Virtual USDT · Simulated desk
          </p>
          <h2
            className="mt-3 font-heading text-3xl font-semibold tracking-tight text-balance text-foreground sm:text-4xl"
            id="final-cta-title"
          >
            Practice before you risk.
          </h2>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-secondary">
            Learn the mechanics. Understand how leverage changes a position. Build experience with
            virtual capital.
          </p>
          <div className="mt-6 flex flex-col items-stretch gap-1 sm:flex-row sm:items-center sm:gap-3">
            <StartPaperTradingLink />
            <a className={exploreLinkClass} href="#how-it-works">
              Explore how it works
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
