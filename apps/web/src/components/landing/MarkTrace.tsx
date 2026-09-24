/**
 * Viewport geometry for marks already received on this page.
 * Y positions are not order prices, balances, or ledger values.
 */

type Point = { x: number; y: number };

export function MarkTrace({ prints }: { prints: string[] }) {
  const points = tracePoints(prints);
  const latest = points?.[points.length - 1];

  return (
    <div className="border-t border-border px-3 py-3 sm:px-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-secondary">
          Session mark prints
        </p>
        <p className="text-[11px] text-secondary">Not historical candles</p>
      </div>
      {points && latest ? (
        <svg
          aria-label="Session mark prints received during this visit, scaled to those prints"
          className="mt-2 h-16 w-full text-secondary sm:h-20"
          preserveAspectRatio="none"
          role="img"
          viewBox="0 0 100 40"
        >
          <g aria-hidden="true" className="text-border">
            {[25, 50, 75].map((x) => (
              <line key={x} stroke="currentColor" strokeWidth="0.35" x1={x} x2={x} y1="4" y2="36" />
            ))}
          </g>
          <polyline
            fill="none"
            points={points.map((point) => `${point.x},${point.y}`).join(" ")}
            stroke="currentColor"
            strokeWidth="1.25"
            vectorEffect="non-scaling-stroke"
          />
          <circle
            key={`${latest.x}-${latest.y}`}
            className="trace-latest fill-foreground"
            cx={latest.x}
            cy={latest.y}
            r="1.7"
          />
        </svg>
      ) : (
        <p className="mt-3 text-sm text-secondary">
          Waiting for a live mark. This line is not a historical chart.
        </p>
      )}
    </div>
  );
}

function tracePoints(prints: string[]): Point[] | null {
  if (prints.length < 2) {
    return null;
  }

  const coordinates = prints.map(toCoordinate);

  if (coordinates.some((coordinate) => coordinate === null)) {
    return null;
  }

  const values = coordinates as number[];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  return values.map((value, index) => ({
    x: prints.length === 1 ? 0 : (index / (prints.length - 1)) * 100,
    y: 36 - ((value - min) / span) * 32,
  }));
}

function toCoordinate(value: string): number | null {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    return null;
  }

  const coordinate = Number(value);
  return Number.isFinite(coordinate) ? coordinate : null;
}
