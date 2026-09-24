import { Input } from "../ui/Input.tsx";
import { FeedStatus, SessionClock } from "./DeskChrome.tsx";
import { LiveMarketFigures, SymbolSwitch } from "./LiveMarketFigures.tsx";
import { Eyebrow, LandingSection, sectionBody, sectionTitle } from "./LandingSection.tsx";
import { MarkTrace } from "./MarkTrace.tsx";
import { useLandingMarket } from "./use-landing-market.ts";

export function TerminalShowcase() {
  const { prints } = useLandingMarket();

  return (
    <LandingSection id="terminal" titleId="terminal-title">
      <div className="max-w-3xl">
        <Eyebrow index="06" label="Desk" />
        <h2 className={`mt-3 ${sectionTitle}`} id="terminal-title">
          A paper trading desk
        </h2>
        <p className={sectionBody}>
          The quote is live when the Notional market feed is connected. Order, position, and
          history rows in this frame are a product preview. They are not your account.
        </p>
      </div>
      <div
        aria-label="Product preview"
        className="mt-8 min-w-0 max-w-full border border-border bg-surface"
        role="region"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-surface-subtle px-2 sm:px-3">
          <SymbolSwitch />
          <span className="hidden font-numeric text-[10px] uppercase tracking-[0.16em] text-secondary sm:inline">
            Perp
          </span>
          <FeedStatus />
          <p className="py-2 text-[11px] uppercase tracking-[0.14em] text-secondary">Product preview</p>
          <SessionClock className="ml-auto hidden sm:inline" />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-3 py-2 font-numeric text-[11px] text-secondary sm:px-4">
          <span>
            Mode <span className="text-foreground">Cross</span>
          </span>
          <span>
            Side <span className="text-foreground">Long</span>
          </span>
          <span>
            Leverage <span className="text-foreground">10×</span>
          </span>
          <span className="sm:ml-auto">Preview · not your account</span>
        </div>
        <LiveMarketFigures />
        <div className="grid min-w-0 border-t border-border lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="min-w-0 bg-surface-subtle">
            <MarkTrace prints={prints} />
          </div>
          <TicketPreview />
        </div>
        <div className="min-w-0 border-t border-border">
          <PreviewTable
            caption="Illustrative position. Not a live account."
            columns={["Symbol", "Side", "Size", "Entry", "uPnL", "Margin"]}
            rows={[["BTCUSDT", "Long", "0.100", "60,000.00", "+42.00 gain", "600.00 isolated"]]}
          />
          <PreviewTable
            caption="Illustrative open order. Not working on this page."
            columns={["Symbol", "Type", "Side", "Qty", "Price", "Status"]}
            rows={[["BTCUSDT", "Limit", "Buy", "0.050", "59,400.00", "Preview"]]}
          />
          <PreviewTable
            caption="Illustrative execution. Not your fill history."
            columns={["Symbol", "Type", "Side", "Qty", "Price"]}
            rows={[["BTCUSDT", "Market", "Sell", "0.020", "60,420.00"]]}
          />
        </div>
        <div className="flex flex-col gap-1 border-t border-border px-3 py-3 text-sm sm:flex-row sm:items-baseline sm:justify-between sm:px-4">
          <p className="text-secondary">
            Illustrative virtual balance{" "}
            <span className="font-numeric text-foreground">1,000.00 USDT</span>
          </p>
          <p className="text-xs text-secondary">
            New paper accounts are credited 1,000 virtual USDT. This is not your balance.
          </p>
        </div>
      </div>
    </LandingSection>
  );
}

function TicketPreview() {
  return (
    <div className="min-w-0 border-t border-border p-4 lg:border-t-0 lg:border-l">
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-secondary">Order ticket</p>
      <p className="mt-2 text-sm leading-relaxed text-secondary">
        Preview controls. Orders are placed on the trading desk after you open a paper account.
      </p>
      <fieldset className="mt-4 space-y-3" disabled>
        <legend className="sr-only">Inactive order ticket preview</legend>
        <div className="grid grid-cols-2 gap-2">
          <span className="border border-accent bg-accent-soft px-2 py-2 text-center text-sm text-foreground">
            Long
          </span>
          <span className="border border-border px-2 py-2 text-center text-sm text-muted">Short</span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <span className="border border-accent bg-accent-soft px-2 py-2 text-center text-foreground">
            Cross
          </span>
          <span className="border border-border px-2 py-2 text-center text-muted">Isolated</span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <span className="border border-accent bg-accent-soft px-2 py-2 text-center text-foreground">
            Market
          </span>
          <span className="border border-border px-2 py-2 text-center text-muted">Limit</span>
        </div>
        <label className="block text-xs text-muted" htmlFor="preview-leverage">
          Leverage
          <Input className="mt-1" id="preview-leverage" numeric readOnly value="10" />
        </label>
        <label className="block text-xs text-muted" htmlFor="preview-quantity">
          Quantity
          <Input className="mt-1" id="preview-quantity" numeric readOnly value="0.010" />
        </label>
      </fieldset>
    </div>
  );
}

function PreviewTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: string[];
  rows: string[][];
}) {
  return (
    <div className="overflow-x-auto border-t border-border first:border-t-0">
      <table className="w-full min-w-[36rem] text-left text-sm">
        <caption className="px-3 py-2 text-left text-xs text-secondary sm:px-4">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column}
                className="px-3 py-2 text-[11px] font-medium uppercase tracking-[0.12em] text-secondary sm:px-4"
                scope="col"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.join("-")} className="border-t border-border">
              {row.map((cell, index) => (
                <td
                  key={`${columns[index]}-${cell}`}
                  className={
                    cell.includes("gain")
                      ? "px-3 py-2 font-numeric text-positive sm:px-4"
                      : "px-3 py-2 font-numeric text-foreground sm:px-4"
                  }
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
