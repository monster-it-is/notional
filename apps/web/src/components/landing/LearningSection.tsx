import { Eyebrow, LandingSection, sectionBody, sectionTitle } from "./LandingSection.tsx";
import { StartPaperTradingLink } from "./PaperTradeLink.tsx";

const TOPICS = [
  {
    id: "what-is-leverage",
    title: "What is leverage?",
    body: "Leverage sets how much notional exposure a given margin controls. It changes the result of a market move relative to that margin. It does not create an edge.",
  },
  {
    id: "margin",
    title: "What is margin?",
    body: "Margin is the virtual collateral behind a position. Cross margin shares it across positions. Isolated margin keeps it with one position.",
  },
  {
    id: "long-vs-short",
    title: "Long vs short",
    body: "A long gains when the mark rises and loses when it falls. A short does the opposite. Notional lets you practice both.",
  },
  {
    id: "market-vs-limit",
    title: "Market vs limit",
    body: "A market order is for immediate execution against the current book. A limit order rests at a price you choose until it can be filled or you cancel it.",
  },
  {
    id: "mark-price",
    title: "What is mark price?",
    body: "The mark is the price used to value positions and check risk. The index and the best bid and ask are shown beside it. They are not the same number.",
  },
  {
    id: "how-funding-works",
    title: "How funding works",
    body: "Perpetual contracts use a funding rate so the contract stays near the index. Notional applies those payments to paper positions.",
  },
  {
    id: "how-liquidation-works",
    title: "How liquidation works",
    body: "If margin is no longer enough, Notional simulates liquidation. It is a paper event that shows the consequence of insufficient collateral.",
  },
  {
    id: "understanding-pnl",
    title: "Understanding PnL",
    body: "Unrealized PnL is the open result against the mark. Realized PnL is what remains after a reduce or close. Neither predicts a future real-money result.",
  },
  {
    id: "position-sizing",
    title: "Position sizing",
    body: "Size and leverage together decide notional. A small margin at high leverage can be a large exposure. The leverage lab shows that relationship.",
  },
  {
    id: "risk-management",
    title: "Risk management",
    body: "Decide the loss you can tolerate before choosing leverage. Practice reducing a position, including reduce-only orders, before you need the idea in a real market.",
  },
] as const;

export function LearningSection() {
  return (
    <LandingSection id="learn" titleId="learn-title">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Eyebrow index="07" label="Learn" />
          <h2 className={`mt-3 ${sectionTitle}`} id="learn-title">
            Learn before you trade
          </h2>
          <p className={sectionBody}>
            Notional is a place to meet these ideas with a position, not only a definition. Nothing
            here promises a result in a real market.
          </p>
        </div>
        <StartPaperTradingLink>Practice these concepts</StartPaperTradingLink>
      </div>
      <ul className="mt-10 border-t border-border">
        {TOPICS.map((topic) => (
          <li
            key={topic.id}
            className="grid scroll-mt-24 gap-2 border-b border-border py-4 sm:grid-cols-[14rem_1fr] sm:gap-8"
            id={topic.id}
          >
            <h3 className="text-base font-medium text-foreground">{topic.title}</h3>
            <p className="text-sm leading-relaxed text-secondary">{topic.body}</p>
          </li>
        ))}
      </ul>
    </LandingSection>
  );
}
