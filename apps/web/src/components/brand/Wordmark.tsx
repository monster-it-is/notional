export function Wordmark() {
  return (
    <svg aria-hidden="true" className="h-5 w-5 text-foreground" viewBox="0 0 20 20">
      <rect fill="none" height="18" stroke="currentColor" strokeWidth="1" width="18" x="1" y="1" />
      <path d="M4 14h12" stroke="currentColor" strokeWidth="1" />
      <path d="M7 14V9" stroke="currentColor" strokeWidth="1" />
      <path className="stroke-accent" d="M13 14V5" strokeWidth="1.5" />
    </svg>
  );
}
