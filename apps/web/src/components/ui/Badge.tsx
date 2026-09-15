export function Badge({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-app-accent-border bg-app-accent-bg px-2 py-0.5 text-xs font-semibold tracking-wide text-app-heading uppercase">
      {children}
    </span>
  );
}
