import type { ReactNode } from "react";

import { landingContainer, landingSectionY } from "./LandingSection.tsx";
import { PaperDestinationLink } from "./PaperTradeLink.tsx";

const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export function LandingFooter() {
  return (
    <footer className="border-t border-border bg-surface-subtle">
      <div className={`${landingContainer} ${landingSectionY}`}>
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="font-heading text-base font-semibold text-foreground">Notional</p>
            <p className="mt-3 text-sm leading-relaxed text-secondary">
              Notional is a simulated paper trading platform for crypto perpetual futures. Virtual
              funds only. No real assets are exchanged.
            </p>
          </div>
          <FooterColumn title="Product">
            <PaperDestinationLink className={`landing-quiet text-sm ${FOCUS}`}>Trading</PaperDestinationLink>
            <FooterAnchor href="#product">Features</FooterAnchor>
            <FooterAnchor href="#how-it-works">How It Works</FooterAnchor>
          </FooterColumn>
          <FooterColumn title="Learn">
            <FooterAnchor href="#leverage-lab">Leverage</FooterAnchor>
            <FooterAnchor href="#margin">Margin</FooterAnchor>
            <FooterAnchor href="#risk">Risk</FooterAnchor>
            <FooterAnchor href="#faq">FAQ</FooterAnchor>
          </FooterColumn>
          <FooterColumn title="Project">
            <p className="text-sm leading-relaxed text-secondary">
              A practice desk for people learning perpetual futures before they consider real
              capital.
            </p>
            <FooterAnchor href="#risk">Risk disclosure</FooterAnchor>
            <p className="text-sm text-secondary">Market data is served by the Notional backend.</p>
          </FooterColumn>
        </div>
        <p className="mt-10 border-t border-border pt-6 text-xs text-secondary">
          Educational simulator. Not a broker or exchange. Paper results are not a prediction.
        </p>
      </div>
    </footer>
  );
}

function FooterColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-secondary">{title}</p>
      {children}
    </div>
  );
}

function FooterAnchor({ href, children }: { href: string; children: string }) {
  return (
    <a className={`landing-quiet inline-flex min-h-11 items-center text-sm ${FOCUS}`} href={href}>
      {children}
    </a>
  );
}
