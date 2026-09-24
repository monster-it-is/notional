import { useId, useState } from "react";

import { LandingSection, sectionBody, sectionTitle } from "./LandingSection.tsx";

const QUESTIONS = [
  {
    question: "Is this real-money trading?",
    answer:
      "No. Notional is a paper trading simulator. Balances are virtual USDT. No real financial assets are traded or held.",
  },
  {
    question: "What is paper futures trading?",
    answer:
      "It is simulated perpetual-futures trading. You can place market and limit orders, hold long or short positions, and see margin, PnL, funding, and liquidation behavior with virtual funds.",
  },
  {
    question: "Are the market prices real?",
    answer:
      "Mark price, index price, best bid, best ask, and the funding rate are live market information delivered by the Notional backend. This page subscribes to that public market stream for one symbol at a time. It does not open a connection to Binance. Figures marked sample, illustrative, or preview are not live positions.",
  },
  {
    question: "Can I practice both long and short trades?",
    answer:
      "Yes. The desk supports buy/long and sell/short, including reduce-only orders when you want to exit without increasing exposure.",
  },
  {
    question: "How does leverage work?",
    answer:
      "Leverage sets notional exposure relative to margin. Notional supports 1× through 100×. It magnifies both gains and losses. The leverage lab on this page is an educational estimate before fees, funding, and liquidation. It is not a suggestion to use high leverage.",
  },
  {
    question: "What is margin?",
    answer:
      "Margin is the virtual collateral backing a position. Cross margin shares collateral across positions. Isolated margin confines it to one position. You can switch models on the desk when the product rules allow it.",
  },
  {
    question: "What happens during liquidation?",
    answer:
      "If margin is insufficient, Notional simulates liquidation. It shows the consequence inside the paper account. No real collateral exists to be seized.",
  },
  {
    question: "What is perpetual funding?",
    answer:
      "Perpetual contracts use a funding rate so price stays near the index. Notional applies funding payments to paper positions using the rate from the market feed.",
  },
  {
    question: "What happens if I run out of virtual USDT?",
    answer:
      "New exposure needs available virtual balance. A paper faucet can add virtual USDT. The amount is set by the server, and a cooldown applies. Suspended accounts cannot trade or claim the faucet.",
  },
  {
    question: "Is Notional suitable for beginners?",
    answer:
      "It is built for people who want to practice futures mechanics before risking real capital. It does not guarantee that you will learn, profit, or be ready for a real market. Real leveraged trading remains risky.",
  },
] as const;

export function FaqSection() {
  return (
    <LandingSection id="faq" titleId="faq-title">
      <div className="grid gap-8 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-4">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-secondary">FAQ</p>
          <h2 className={`mt-3 ${sectionTitle}`} id="faq-title">
            Questions
          </h2>
          <p className={sectionBody}>
            Straight answers about what the simulator does, and what it does not do.
          </p>
        </div>
        <div className="border-t border-border lg:col-span-8">
          {QUESTIONS.map((item) => (
            <FaqItem key={item.question} answer={item.answer} question={item.question} />
          ))}
        </div>
      </div>
    </LandingSection>
  );
}

function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const buttonId = useId();

  return (
    <div className="border-b border-border">
      <h3>
        <button
          aria-controls={panelId}
          aria-expanded={open}
          className="flex min-h-11 w-full items-center justify-between gap-4 py-3 text-left text-base font-medium text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          id={buttonId}
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          {question}
          <span aria-hidden="true" className="font-numeric text-muted">
            {open ? "–" : "+"}
          </span>
        </button>
      </h3>
      {open ? (
        <div
          aria-labelledby={buttonId}
          className="pb-4 pr-8 text-sm leading-relaxed text-secondary"
          id={panelId}
          role="region"
        >
          {answer}
        </div>
      ) : null}
    </div>
  );
}
