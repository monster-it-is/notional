import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { DrawingsMenu } from "./DrawingsMenu.tsx";
import type { DrawingTool } from "../../lib/chart/drawings/types.ts";

function Harness({
  initial = "select",
  onChange,
}: {
  initial?: DrawingTool;
  onChange?: (tool: DrawingTool) => void;
}) {
  const [tool, setTool] = useState<DrawingTool>(initial);
  return (
    <DrawingsMenu
      tool={tool}
      onToolChange={(next) => {
        setTool(next);
        onChange?.(next);
      }}
    />
  );
}

describe("DrawingsMenu", () => {
  it("exposes an accessible drawings control without menu semantics", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const trigger = screen.getByRole("button", { name: "Drawings" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Select" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Trend Line" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Horizontal Line" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("activates Trend Line and represents the selected tool on the trigger", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Drawings" }));
    await user.click(screen.getByRole("button", { name: "Trend Line" }));
    expect(onChange).toHaveBeenCalledWith("trend-line");
    expect(screen.getByRole("button", { name: "Drawings, Trend Line" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Trend Line" })).not.toBeInTheDocument();
  });

  it("returns to Select from Horizontal Line", async () => {
    const user = userEvent.setup();
    render(<Harness initial="horizontal-line" />);
    expect(screen.getByRole("button", { name: "Drawings, Horizontal Line" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Drawings, Horizontal Line" }));
    await user.click(screen.getByRole("button", { name: "Select" }));
    expect(screen.getByRole("button", { name: "Drawings" })).toBeInTheDocument();
  });
});
