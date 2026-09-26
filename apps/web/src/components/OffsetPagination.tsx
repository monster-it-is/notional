import { Button } from "./ui/Button.tsx";

export function OffsetPagination({
  offset,
  pageSize,
  rowCount,
  onPrevious,
  onNext,
}: {
  offset: number;
  pageSize: number;
  rowCount: number | null;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const previousDisabled = offset === 0;
  const nextDisabled = rowCount === null || rowCount !== pageSize;
  const from = offset + 1;
  const to = offset + (rowCount ?? 0);

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <Button type="button" disabled={previousDisabled} onClick={onPrevious}>
        Previous
      </Button>
      <Button type="button" disabled={nextDisabled} onClick={onNext}>
        Next
      </Button>
      {rowCount !== null && rowCount > 0 ? (
        <span className="text-sm text-secondary">
          Showing {from}–{to}
        </span>
      ) : null}
    </div>
  );
}
