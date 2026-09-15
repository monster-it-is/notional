import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "buy" | "sell" | "ghost";

const styles: Record<Variant, string> = {
  primary:
    "bg-app-accent text-white hover:opacity-90 disabled:opacity-50",
  secondary:
    "border border-app-border bg-app-bg text-app-heading hover:bg-app-accent-bg disabled:opacity-50",
  buy: "bg-app-buy text-white hover:opacity-90 disabled:opacity-50",
  sell: "bg-app-sell text-white hover:opacity-90 disabled:opacity-50",
  ghost: "text-app-heading hover:bg-app-accent-bg disabled:opacity-50",
};

export function Button({
  variant = "secondary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-medium ${styles[variant]} ${className}`}
      {...props}
    />
  );
}
