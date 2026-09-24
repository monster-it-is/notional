import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";

import { cn } from "../../lib/cn.ts";

export function DataTable({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="data-table">{children}</table>
    </div>
  );
}

export function Th({ className = "", scope = "col", ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th {...props} className={className} scope={scope} />;
}

export function Td({
  numeric = false,
  className = "",
  ...props
}: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return <td className={cn(numeric && "numeric", className)} {...props} />;
}

export function TableStatus({ children }: { children: string }) {
  return <p className="py-4 text-sm text-secondary">{children}</p>;
}
