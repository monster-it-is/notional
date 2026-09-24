import { useState } from "react";

import { Input } from "../ui/Input.tsx";
import {
  formatSignedPercentPoints,
  formatSignedTradingAmount,
  formatTradingAmount,
  toneClass,
  tradingOutcome,
  tradingTone,
} from "./format-decimal.ts";
import { Eyebrow, LandingSection, sectionBody, sectionTitle } from "./LandingSection.tsx";
import { estimateLeverageScenario, type LabDirection } from "./leverage-lab-math.ts";

export function LeverageLab() {
  const [direction, setDirection] = useState<LabDirection>("LONG");
  const [margin, setMargin] = useState("1000");
  const [leverage, setLeverage] = useState("10");
  const [move, setMove] = useState("1");
  const [entry, setEntry] = useState("100000");
  const estimate = estimateLeverageScenario({
    direction,
    margin,
    leverage,
    movePercent: move,
    entryPrice: entry,
  });
  const marginIncomplete = margin.trim() === "" || margin.trim() === "." || /^\d+\.$/.test(margin.trim());

  return (
    <LandingSection id="leverage-lab" titleId="leverage-lab-title" className="bg-surface-subtle">
      <div className="max-w-3xl">
        <Eyebrow index="04" label="Leverage" />
        <h2 className={`mt-3 ${sectionTitle}`} id="leverage-lab-title">
          See how leverage changes a result.
        </h2>
        <p className={sectionBody}>
          An isolated-margin illustration. It is not an order, not a recommendation, and not a
          forecast. Fees, funding, and the gap between mark and execution price are excluded.
        </p>
      </div>
      <div className="mt-8 grid border border-border bg-surface lg:grid-cols-2">
        <form
          className="space-y-5 border-b border-border p-4 sm:p-6 lg:border-r lg:border-b-0"
          onSubmit={(event) => event.preventDefault()}
        >
          <fieldset>
            <legend className="text-sm font-medium text-foreground">Direction</legend>
            <div className="mt-2 flex gap-2">
              {(["LONG", "SHORT"] as const).map((side) => (
                <label
                  key={side}
                  className={
                    direction === side
                      ? "inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center border border-accent bg-accent-soft text-sm text-foreground has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring"
                      : "inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center border border-border text-sm text-secondary has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring"
                  }
                >
                  <input
                    checked={direction === side}
                    className="sr-only"
                    name="lab-direction"
                    onChange={() => setDirection(side)}
                    type="radio"
                    value={side}
                  />
                  {side === "LONG" ? "Long" : "Short"}
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label className="text-sm font-medium text-foreground" htmlFor="lab-margin">
              Virtual margin
            </label>
            <Input
              className="mt-2"
              id="lab-margin"
              inputMode="decimal"
              invalid={!marginIncomplete && !estimate.ok && estimate.reason === "margin"}
              numeric
              onChange={(event) => setMargin(event.target.value)}
              spellCheck={false}
              value={margin}
            />
            <p className="mt-2 text-xs text-secondary">USDT assigned to this illustration. Try 1000.</p>
          </div>
          <Slider
            id="lab-leverage"
            label="Leverage"
            max="100"
            min="1"
            onChange={setLeverage}
            value={leverage}
            valueText={`${leverage}×`}
          />
          <p className="text-xs leading-relaxed text-secondary">
            Notional allows 1× to 100×. A higher multiple is not a better setting.
          </p>
          <Slider
            id="lab-move"
            label="Market movement"
            max="10"
            min="-10"
            onChange={setMove}
            value={move}
            valueText={formatMove(move)}
          />
          <div>
            <label className="text-sm font-medium text-foreground" htmlFor="lab-entry">
              Entry price
            </label>
            <Input
              className="mt-2"
              id="lab-entry"
              inputMode="decimal"
              numeric
              onChange={(event) => setEntry(event.target.value)}
              spellCheck={false}
              value={entry}
            />
            <p className="mt-2 text-xs text-secondary">
              Illustrative only. For this linear estimate, PnL depends on notional and the percent
              move. Entry is used to show a corresponding mark.
            </p>
          </div>
        </form>
        <div aria-label="Estimate" className="bg-surface-subtle p-4 sm:p-6" role="group">
          {estimate.ok ? (
            <Estimate figures={estimate.figures} leverage={leverage} move={move} />
          ) : (
            <p className="text-sm text-secondary">
              {marginIncomplete
                ? "Finish the margin amount to update the estimate."
                : "Enter virtual margin as a positive decimal, such as 1000."}
            </p>
          )}
        </div>
      </div>
    </LandingSection>
  );
}

function Estimate({
  figures,
  leverage,
  move,
}: {
  figures: {
    notional: string;
    initialMargin: string;
    estimatedPnl: string;
    roePercent: string;
    equity: string;
    markPrice: string | null;
    maintenanceMargin: string;
    maintenanceBreached: boolean;
  };
  leverage: string;
  move: string;
}) {
  const tone = tradingTone(figures.estimatedPnl);
  const outcome = tradingOutcome(figures.estimatedPnl);
  const moveAbs = move.startsWith("-") ? move.slice(1) : move;
  const roeAbs = figures.roePercent.startsWith("-")
    ? figures.roePercent.slice(1)
    : figures.roePercent;

  const readoutKey = `${figures.estimatedPnl}|${figures.roePercent}|${leverage}|${move}`;

  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-secondary">
        Educational estimate
      </p>
      <div key={readoutKey} className="lab-settle mt-4 grid grid-cols-2 gap-px bg-border sm:grid-cols-3">
        <Readout label="Margin" value={`${formatTradingAmount(figures.initialMargin)} USDT`} />
        <Readout label="Leverage" value={`${leverage}×`} />
        <Readout label="Exposure" value={`${formatTradingAmount(figures.notional)} USDT`} />
        <Readout label="Market move" value={formatMove(move)} />
        <Readout
          label="Simulated PnL"
          tone={tone}
          value={`${formatSignedTradingAmount(figures.estimatedPnl)} ${outcome} `}
        />
        <Readout label="ROE" tone={tradingTone(figures.roePercent)} value={formatSignedPercentPoints(figures.roePercent)} />
      </div>
      <p className="mt-4 font-numeric text-xs text-secondary">
        {formatTradingAmount(figures.initialMargin)} × {leverage}× → {formatTradingAmount(figures.notional)}
      </p>
      <dl className="mt-4 divide-y divide-border border-y border-border">
        <Row label="Equity after move" value={`${formatTradingAmount(figures.equity)} USDT`} />
        <Row
          label="Illustrative mark"
          value={figures.markPrice ? formatTradingAmount(figures.markPrice) : "—"}
        />
        <Row
          label="Maintenance margin"
          value={`${formatTradingAmount(figures.maintenanceMargin)} USDT`}
        />
      </dl>
      <p className="mt-4 text-sm leading-relaxed text-secondary">
        {move === "0"
          ? "With no market move, estimated PnL is flat. Change the move to see how leverage scales the result in both directions."
          : `${leverage}× leverage means a ${moveAbs}% move in the underlying produces roughly a ${roeAbs}% change relative to the margin, before fees, funding, and other mechanics.`}
      </p>
      <p className="mt-3 text-sm leading-relaxed text-foreground">
        Leverage magnifies both gains and losses.
      </p>
      {figures.maintenanceBreached ? (
        <p className="mt-4 border border-warning-border bg-warning-background px-3 py-3 text-sm leading-relaxed text-warning">
          Estimated equity is at or below maintenance margin. On the trading desk, Notional would
          simulate liquidation. This illustration ignores fees and funding.
        </p>
      ) : null}
    </div>
  );
}

function Readout({
  label,
  value,
  tone = "flat",
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative" | "flat";
}) {
  return (
    <div className="bg-surface px-3 py-3">
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-secondary">{label}</p>
      <p className={`mt-1 font-numeric text-sm sm:text-base ${toneClass(tone)}`}>{value}</p>
    </div>
  );
}

function Row({
  label,
  value,
  tone = "flat",
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative" | "flat";
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="text-sm text-secondary">{label}</dt>
      <dd className={`text-right font-numeric text-sm ${toneClass(tone)}`}>{value}</dd>
    </div>
  );
}

function Slider({
  id,
  label,
  min,
  max,
  value,
  valueText,
  onChange,
}: {
  id: string;
  label: string;
  min: string;
  max: string;
  value: string;
  valueText: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label className="text-sm font-medium text-foreground" htmlFor={id}>
          {label}
        </label>
        <span className="font-numeric text-lg text-foreground">{valueText}</span>
      </div>
      <input
        className="w-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        aria-valuetext={valueText}
        id={id}
        max={max}
        min={min}
        onChange={(event) => onChange(event.target.value)}
        step="1"
        type="range"
        value={value}
      />
    </div>
  );
}

function formatMove(move: string): string {
  if (move === "0" || move === "-0") {
    return "0%";
  }

  return move.startsWith("-") ? `${move}%` : `+${move}%`;
}
