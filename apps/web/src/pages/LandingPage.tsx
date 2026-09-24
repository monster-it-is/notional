import { FaqSection } from "../components/landing/FaqSection.tsx";
import { FinalCta } from "../components/landing/FinalCta.tsx";
import { Capabilities } from "../components/landing/Capabilities.tsx";
import { Hero } from "../components/landing/Hero.tsx";
import { HowItWorks } from "../components/landing/HowItWorks.tsx";
import { LandingFooter } from "../components/landing/LandingFooter.tsx";
import { LandingMarketProvider } from "../components/landing/LandingMarket.tsx";
import { LandingNavbar } from "../components/landing/LandingNavbar.tsx";
import { LearningSection } from "../components/landing/LearningSection.tsx";
import { LeverageLab } from "../components/landing/LeverageLab.tsx";
import { RiskDisclosure } from "../components/landing/RiskDisclosure.tsx";
import { TerminalShowcase } from "../components/landing/TerminalShowcase.tsx";
import { ValueStrip } from "../components/landing/ValueStrip.tsx";
import { WhyPaperTrading } from "../components/landing/WhyPaperTrading.tsx";

export function LandingPage() {
  return (
    <LandingMarketProvider>
      <div className="landing-page overflow-x-clip bg-background text-secondary antialiased">
        <LandingNavbar />
        <main id="main">
          <Hero />
          <ValueStrip />
          <WhyPaperTrading />
          <Capabilities />
          <LeverageLab />
          <HowItWorks />
          <TerminalShowcase />
          <LearningSection />
          <RiskDisclosure />
          <FaqSection />
          <FinalCta />
        </main>
        <LandingFooter />
      </div>
    </LandingMarketProvider>
  );
}
