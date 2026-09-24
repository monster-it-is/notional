import { Eyebrow, LandingSection, sectionBody, sectionTitle } from "./LandingSection.tsx";

const MATRIX = [
  {
    n: "01",
    group: "Execution",
    title: "Market and limit",
    body: "Practice immediate execution and orders that rest at a price, including reduce-only exits.",
  },
  {
    n: "02",
    group: "Risk",
    title: "Cross and isolated",
    body: "Cross shares virtual collateral across positions. Isolated confines it to one position.",
  },
  {
    n: "03",
    group: "Perpetuals",
    title: "Funding and liquidation",
    body: "Funding is applied from the live rate. If margin is insufficient, liquidation is simulated. No real assets are involved.",
  },
  {
    n: "04",
    group: "Market data",
    title: "Mark, index, BBO",
    body: "Mark, index, best bid, best ask, and the funding rate come from the Notional market stream.",
  },
] as const;

const SPECS = [
  {
    title: "Long and short",
    body: "Open exposure in either direction and see how the same market treats each side.",
  },
  {
    title: "Leverage",
    body: "Use 1× to 100× and watch exposure and margin change together. Higher leverage magnifies both gains and losses.",
  },
  {
    title: "Position management",
    body: "Monitor open paper positions, size, entry, and margin mode from the desk.",
  },
  {
    title: "PnL",
    body: "Unrealized results move while a position is open. Realized results are recorded when it is reduced or closed.",
  },
  {
    title: "Trading history",
    body: "Review orders and executions after you place them.",
  },
  {
    title: "Virtual funds",
    body: "A new paper account receives 1,000 virtual USDT. A faucet can add more later. The amount is set by the server, and a cooldown applies.",
  },
] as const;

export function Capabilities() {
  return (
    <LandingSection id="product" titleId="product-title">
      <div className="grid items-start gap-10 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-4">
          <Eyebrow index="03" label="Product" />
          <h2 className={`mt-3 ${sectionTitle}`} id="product-title">
            What you can practice
          </h2>
          <p className={sectionBody}>
            Notional is a trading desk with the capital removed. The practice is the mechanics:
            orders, margin, funding, and simulated liquidation against live market information.
          </p>
        </div>
        <article className="border border-border bg-surface lg:col-span-8">
          <div className="border-b border-border px-4 py-5 sm:px-5">
            <p className="font-numeric text-[11px] uppercase tracking-[0.16em] text-secondary">Core</p>
            <h3 className="mt-2 font-heading text-xl text-foreground">Realistic paper futures</h3>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-secondary">
              Virtual USDT against live market information from the Notional backend. This browser
              does not request prices from an exchange.
            </p>
          </div>
          <ul className="flex flex-wrap gap-x-5 gap-y-2 px-4 py-3 text-[11px] font-medium uppercase tracking-[0.12em] text-secondary sm:px-5">
            <li>Virtual USDT</li>
            <li>Live market feed</li>
            <li>Simulated risk</li>
          </ul>
        </article>
      </div>
      <ol className="mt-6 grid gap-px border border-border bg-border sm:grid-cols-2 xl:grid-cols-4">
        {MATRIX.map((item) => (
          <li key={item.n} className="bg-surface px-4 py-4">
            <p className="font-numeric text-[11px] uppercase tracking-[0.14em] text-secondary">
              <span className="text-accent">{item.n}</span>
              <span className="mx-2 text-border-strong">/</span>
              {item.group}
            </p>
            <h3 className="mt-3 text-sm font-medium text-foreground">{item.title}</h3>
            <p className="mt-1 text-sm leading-relaxed text-secondary">{item.body}</p>
          </li>
        ))}
      </ol>
      <dl className="mt-px grid gap-px border border-border bg-border sm:grid-cols-2">
        {SPECS.map((spec) => (
          <div
            key={spec.title}
            className="grid gap-1 bg-background px-4 py-3 sm:grid-cols-[9rem_1fr] sm:gap-4"
          >
            <dt className="text-sm font-medium text-foreground">{spec.title}</dt>
            <dd className="text-sm leading-relaxed text-secondary">{spec.body}</dd>
          </div>
        ))}
      </dl>
    </LandingSection>
  );
}
