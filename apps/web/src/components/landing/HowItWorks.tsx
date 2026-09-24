import { Eyebrow, LandingSection, sectionBody, sectionTitle } from "./LandingSection.tsx";

const STEPS = [
  {
    n: "01",
    title: "Create your paper account",
    body: "Sign up. Notional opens a simulated account. No real wallet is connected.",
  },
  {
    n: "02",
    title: "Receive virtual USDT",
    body: "The paper account is credited 1,000 virtual USDT. A faucet can add more later, with a server-set amount and a cooldown.",
  },
  {
    n: "03",
    title: "Choose a perpetual market",
    body: "Select an active instrument. The desk shows mark, index, best bid, best ask, and funding from the Notional feed.",
  },
  {
    n: "04",
    title: "Open, manage, and review",
    body: "Place market or limit orders, long or short, cross or isolated. Then review positions, open orders, and executions.",
  },
] as const;

export function HowItWorks() {
  return (
    <LandingSection id="how-it-works" titleId="how-it-works-title">
      <Eyebrow index="05" label="Process" />
      <h2 className={`mt-3 ${sectionTitle}`} id="how-it-works-title">
        How Notional works
      </h2>
      <p className={sectionBody}>Four steps from an empty session to a paper position you can review.</p>
      <div className="relative mt-10">
        <div aria-hidden="true" className="absolute top-3 right-0 left-0 hidden h-px bg-border md:block" />
        <ol className="grid gap-0 md:grid-cols-4 md:gap-8">
          {STEPS.map((step) => (
            <li key={step.n} className="group relative flex gap-4 pb-8 last:pb-0 md:block md:pb-0">
              <div className="flex w-8 shrink-0 flex-col items-center md:w-auto md:items-start">
                <span className="relative z-10 bg-background pr-0 font-numeric text-sm text-accent md:pr-3">
                  {step.n}
                </span>
                <span aria-hidden="true" className="mt-2 w-px flex-1 bg-border group-last:hidden md:hidden" />
              </div>
              <div className="min-w-0 md:mt-5 md:border-t md:border-border md:pt-4">
                <h3 className="text-base font-medium text-foreground">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-secondary">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </LandingSection>
  );
}
