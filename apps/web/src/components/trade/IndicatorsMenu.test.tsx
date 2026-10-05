import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { IndicatorsMenu } from "./IndicatorsMenu.tsx";
import {
  DEFAULT_INDICATOR_SETTINGS,
  type IndicatorSettings,
} from "../../lib/chart/indicators/settings.ts";

function Harness({
  initial = DEFAULT_INDICATOR_SETTINGS,
}: {
  initial?: IndicatorSettings;
}) {
  const [settings, setSettings] = useState(initial);
  return <IndicatorsMenu settings={settings} onSettingsChange={setSettings} />;
}

describe("IndicatorsMenu", () => {
  it("exposes an accessible disclosure without RSI or MACD controls", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const trigger = screen.getByRole("button", { name: "Indicators" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("SMA")).toBeInTheDocument();
    expect(screen.getByLabelText("EMA")).toBeInTheDocument();
    expect(screen.getByLabelText("Bollinger Bands")).toBeInTheDocument();
    expect(screen.queryByLabelText("RSI")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("MACD")).not.toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("toggles SMA immediately and commits a valid period on Enter", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Indicators" }));
    await user.click(screen.getByLabelText("SMA"));
    expect(screen.getByLabelText("SMA")).toBeChecked();
    expect(screen.getByRole("button", { name: "Indicators, 1 enabled" })).toBeInTheDocument();

    const period = screen.getByLabelText("SMA period");
    await user.clear(period);
    await user.type(period, "30");
    await user.keyboard("{Enter}");
    expect(period).toHaveValue("30");
    expect(screen.queryByText(/integer from 1 to 500/i)).not.toBeInTheDocument();
  });

  it("keeps the last valid period when a draft is invalid", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Indicators" }));
    const period = screen.getByLabelText("SMA period");
    await user.clear(period);
    await user.type(period, "9999");
    await user.tab();
    expect(screen.getByText("Enter an integer from 1 to 500.")).toBeInTheDocument();
    expect(period).toHaveAttribute("aria-invalid", "true");
    expect(period).toHaveValue("9999");
  });

  it("closes on Escape and outside click", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <Harness />
        <button type="button">Outside</button>
      </div>,
    );
    const trigger = screen.getByRole("button", { name: "Indicators" });
    await user.click(trigger);
    expect(screen.getByLabelText("SMA")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByLabelText("SMA")).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByLabelText("SMA")).not.toBeInTheDocument();
  });
});
