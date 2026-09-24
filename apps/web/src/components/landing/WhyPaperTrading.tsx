import { Eyebrow, LandingSection, sectionBody, sectionTitle } from "./LandingSection.tsx";

const STEPS = [
  {
    title: "Virtual margin",
    body: "Collateral assigned inside the simulator. It is not a deposit of real money.",
  },
  {
    title: "Leveraged exposure",
    body: "Position notional is about margin multiplied by leverage. 10× controls roughly ten times the margin.",
  },
  {
    title: "Market move",
    body: "Mark, index, and the best bid and ask update from the live feed. The paper position is marked to that.",
  },
  {
    title: "Changing PnL",
    body: "Unrealized results move with the mark. Realized results appear when the position is reduced or closed.",
  },
  {
    title: "Risk",
    body: "Higher leverage leaves less room before maintenance margin. Liquidation, when it happens, is simulated.",
  },
] as const;

export function WhyPaperTrading() {
  return (
    <LandingSection id="why-paper" titleId="why-paper-title">
      <div className="grid items-start gap-10 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-5">
          <Eyebrow index="02" label="Mechanics" />
          <h2 className={`mt-3 ${sectionTitle}`} id="why-paper-title">
            Reading about a position is not the same as holding one.
          </h2>
          <p className={sectionBody}>
            Leverage, margin, liquidation, and PnL can be explained in a paragraph. Managing them
            while the mark moves is a different skill. Notional is the place to practice that
            difference with virtual USDT.
          </p>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-secondary">
            Leverage is a risk setting, not a shortcut. It magnifies losses as readily as gains.
          </p>
        </div>
        <div className="lg:col-span-7">
          <p className="mb-3 text-xs font-medium uppercase tracking-[0.14em] text-secondary">
            Lifecycle of one leveraged paper position
          </p>
          <ol className="border border-border bg-surface">
            {STEPS.map((step, index) => (
              <li
                key={step.title}
                className="grid grid-cols-[2.5rem_1fr] gap-3 border-b border-border px-4 py-4 last:border-b-0"
              >
                <span className="font-numeric text-sm text-muted">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3 className="text-base font-medium text-foreground">{step.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-secondary">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </LandingSection>
  );
}
