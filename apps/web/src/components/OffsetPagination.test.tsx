import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { OffsetPagination } from "./OffsetPagination.tsx";

describe("OffsetPagination", () => {
  it("disables Previous at offset 0 and Next while row count is unresolved", () => {
    render(
      <OffsetPagination
        offset={0}
        pageSize={50}
        rowCount={null}
        onPrevious={() => undefined}
        onNext={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("enables Next only when the page is full", async () => {
    const onNext = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <OffsetPagination
        offset={0}
        pageSize={50}
        rowCount={50}
        onPrevious={() => undefined}
        onNext={onNext}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(onNext).toHaveBeenCalledTimes(1);

    rerender(
      <OffsetPagination
        offset={50}
        pageSize={50}
        rowCount={12}
        onPrevious={() => undefined}
        onNext={onNext}
      />,
    );
    expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.getByText("Showing 51–62")).toBeInTheDocument();
  });

  it("keeps Previous available on an empty trailing page", () => {
    render(
      <OffsetPagination
        offset={50}
        pageSize={50}
        rowCount={0}
        onPrevious={() => undefined}
        onNext={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.queryByText(/Showing/)).not.toBeInTheDocument();
  });
});
