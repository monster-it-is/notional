import { landingContainer } from "./LandingSection.tsx";

export function RiskDisclosure() {
  return (
    <section aria-labelledby="risk-title" className="scroll-mt-24 border-t border-border bg-surface" id="risk">
      <div className={`${landingContainer} py-12 md:py-16`}>
        <p className="font-numeric text-[11px] uppercase tracking-[0.16em] text-secondary">
          <span className="text-accent">08</span>
          <span className="mx-2 text-border-strong">/</span>
          Disclosure
        </p>
        <h2 className="mt-3 font-heading text-2xl font-semibold tracking-tight text-foreground" id="risk-title">
          Risk disclosure
        </h2>
        <div className="mt-5 max-w-3xl space-y-3 text-base leading-relaxed text-foreground">
          <p>Notional uses virtual funds. No real financial assets are traded, transferred, or held.</p>
          <p>
            Paper trading results, including PnL, funding, and simulated liquidation, do not predict
            future real-market performance.
          </p>
          <p>
            Real leveraged futures trading can involve substantial financial risk. Practicing here
            does not remove that risk.
          </p>
          <p>Notional is an educational simulator. It is not a broker, an exchange, or an offer to trade real markets.</p>
        </div>
      </div>
    </section>
  );
}
