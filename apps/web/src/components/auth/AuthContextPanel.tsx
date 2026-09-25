import { useLocation } from "react-router";

import { cn } from "../../lib/cn.ts";

const CAPABILITIES = [
  { value: "Market + Limit", label: "Order types" },
  { value: "Cross + Isolated", label: "Margin modes" },
  { value: "Long + Short", label: "Position direction" },
  { value: "Live market data", label: "Through Notional" },
] as const;

export function AuthContextPanel() {
  const { pathname } = useLocation();
  const signup = pathname === "/signup";

  return (
    <aside
      aria-labelledby="auth-context-title"
      className={cn(
        "hidden border-border md:block",
        "border-t px-4 py-4 sm:px-6",
        "xl:flex xl:h-full xl:flex-col xl:items-center xl:border-t-0 xl:border-l xl:bg-background xl:px-10 xl:py-12",
      )}
    >
      <div className="w-full max-w-md border border-border bg-surface xl:max-w-xl">
        <div className="border-b border-border bg-surface-subtle px-4 py-2.5 xl:px-5">
          <p className="border-l-2 border-l-accent pl-2 font-numeric text-[10px] font-medium uppercase tracking-[0.18em] text-accent">
            Paper trading
          </p>
        </div>
        <div className="px-4 py-4 xl:px-5 xl:py-5">
          <h2
            className="font-heading text-lg font-semibold tracking-tight text-foreground xl:text-2xl"
            id="auth-context-title"
          >
            {signup ? "Your paper account" : "Inside the paper desk"}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-secondary">
            {signup
              ? "Creating an account opens a simulated perpetual-futures session. The desk credits virtual funds. No real assets are transferred."
              : "A simulated perpetual-futures environment. Orders, margin, and positions use virtual funds."}
          </p>
          <div className="mt-4 border border-border bg-background px-3 py-3 xl:mt-5 xl:px-4 xl:py-4">
            <p className="font-numeric text-[10px] uppercase tracking-[0.16em] text-secondary">
              {signup ? "Starting virtual balance" : "New accounts start with"}
            </p>
            <p className="mt-1 font-numeric text-2xl tracking-tight text-foreground xl:text-3xl">
              1,000
              <span className="ml-2 text-sm tracking-[0.14em] text-accent">USDT</span>
            </p>
            <p className="mt-1 text-xs leading-relaxed text-secondary">
              {signup
                ? "Credited when the account is created. Virtual funds only."
                : "A signup allocation. Not the balance of a signed-in account."}
            </p>
          </div>
        </div>
        <ul className="hidden border-t border-border bg-border xl:grid xl:grid-cols-2 xl:gap-px">
          {CAPABILITIES.map((item) => (
            <li key={item.label} className="bg-surface px-4 py-3 xl:px-5">
              <p className="font-numeric text-xs text-foreground">{item.value}</p>
              <p className="mt-1 font-numeric text-[10px] uppercase tracking-[0.14em] text-secondary">
                {item.label}
              </p>
            </li>
          ))}
        </ul>
        <p className="border-t border-border px-4 py-2 font-numeric text-[10px] uppercase leading-relaxed tracking-[0.12em] text-secondary xl:hidden">
          Market + Limit · Cross + Isolated · Long + Short
        </p>
        <p className="border-t border-border px-4 py-2.5 text-[11px] leading-relaxed tracking-wide text-secondary xl:px-5">
          No wallet · No real assets · No exchange orders
        </p>
      </div>
    </aside>
  );
}
