import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router";
import { describe, expect, it } from "vitest";

import {
  parseHistoryOffset,
  parseHistorySearch,
  serializeHistorySearch,
  useHistoryParams,
} from "./use-history-params.ts";

describe("parseHistorySearch", () => {
  it("defaults to the orders tab with omitted offset and All status", () => {
    expect(parseHistorySearch(new URLSearchParams())).toEqual({
      tab: "orders",
      symbol: "",
      status: "",
      offset: 0,
    });
  });

  it("canonicalizes invalid tab, status, and offset", () => {
    const params = new URLSearchParams("tab=bogus&status=REJECTED&offset=-1&symbol=btcusdt");
    expect(parseHistorySearch(params)).toEqual({
      tab: "orders",
      symbol: "BTCUSDT",
      status: "",
      offset: 0,
    });
  });

  it("drops status when the tab is not orders and symbol when the tab has no symbol filter", () => {
    expect(
      parseHistorySearch(new URLSearchParams("tab=executions&status=OPEN&symbol=ETHUSDT&offset=50")),
    ).toEqual({
      tab: "executions",
      symbol: "ETHUSDT",
      status: "",
      offset: 50,
    });

    expect(
      parseHistorySearch(new URLSearchParams("tab=funding&symbol=BTCUSDT&status=FILLED&offset=50")),
    ).toEqual({
      tab: "funding",
      symbol: "",
      status: "",
      offset: 50,
    });
  });

  it("omits default tab, All status, and offset 0 from the serialized URL", () => {
    expect(
      serializeHistorySearch({
        tab: "orders",
        symbol: "",
        status: "",
        offset: 0,
      }).toString(),
    ).toBe("");

    expect(
      serializeHistorySearch({
        tab: "executions",
        symbol: "BTCUSDT",
        status: "OPEN",
        offset: 50,
      }).toString(),
    ).toBe("tab=executions&symbol=BTCUSDT&offset=50");
  });

  it("parses offset without Number or parseInt", () => {
    expect(parseHistoryOffset(null)).toBe(0);
    expect(parseHistoryOffset("0")).toBe(0);
    expect(parseHistoryOffset("50")).toBe(50);
    expect(parseHistoryOffset("12abc")).toBe(0);
    expect(parseHistoryOffset("100")).toBe(100);
  });
});

function HistoryParamsProbe() {
  const history = useHistoryParams();
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <div>
      <span data-testid="search">{location.search}</span>
      <span data-testid="tab">{history.tab}</span>
      <span data-testid="symbol">{history.symbol}</span>
      <span data-testid="status">{history.status || "ALL"}</span>
      <span data-testid="offset">{String(history.offset)}</span>
      <button type="button" onClick={() => history.setTab("executions")}>
        go-executions
      </button>
      <button type="button" onClick={() => history.setTab("funding")}>
        go-funding
      </button>
      <button type="button" onClick={() => history.setTab("orders")}>
        go-orders
      </button>
      <button type="button" onClick={() => history.setSymbol("B")}>
        type-b
      </button>
      <button type="button" onClick={() => history.setSymbol("BT")}>
        type-bt
      </button>
      <button type="button" onClick={() => history.setStatus("FILLED")}>
        status-filled
      </button>
      <button type="button" onClick={() => history.setStatus("")}>
        status-all
      </button>
      <button type="button" onClick={() => history.setOffset(50)}>
        next-page
      </button>
      <button type="button" onClick={() => navigate(-1)}>
        back
      </button>
    </div>
  );
}

function renderHistory(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/history" element={<HistoryParamsProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("useHistoryParams", () => {
  it("canonicalizes invalid URL values in place", async () => {
    renderHistory("/history?tab=bogus&status=NOPE&offset=abc&symbol=ethusdt");
    expect(await screen.findByTestId("tab")).toHaveTextContent("orders");
    expect(screen.getByTestId("symbol")).toHaveTextContent("ETHUSDT");
    expect(screen.getByTestId("status")).toHaveTextContent("ALL");
    expect(screen.getByTestId("offset")).toHaveTextContent("0");
    expect(screen.getByTestId("search")).toHaveTextContent("?symbol=ETHUSDT");
  });

  it("removes status when leaving Orders and symbol when opening funding", async () => {
    const user = userEvent.setup();
    renderHistory("/history?status=OPEN&symbol=BTCUSDT");

    await user.click(screen.getByRole("button", { name: "go-executions" }));
    expect(screen.getByTestId("search").textContent).toBe("?tab=executions&symbol=BTCUSDT");

    await user.click(screen.getByRole("button", { name: "go-funding" }));
    expect(screen.getByTestId("search").textContent).toBe("?tab=funding");
  });

  it("resets offset when filters change and omits offset 0", async () => {
    const user = userEvent.setup();
    renderHistory("/history?offset=50&status=FILLED");

    expect(screen.getByTestId("offset")).toHaveTextContent("50");
    await user.click(screen.getByRole("button", { name: "status-all" }));
    expect(screen.getByTestId("offset")).toHaveTextContent("0");
    expect(screen.getByTestId("search").textContent).toBe("");
  });

  it("replaces the URL for symbol keystrokes so back skips intermediate typing", async () => {
    const user = userEvent.setup();
    renderHistory("/history");

    await user.click(screen.getByRole("button", { name: "go-executions" }));
    await user.click(screen.getByRole("button", { name: "type-b" }));
    await user.click(screen.getByRole("button", { name: "type-bt" }));
    expect(screen.getByTestId("search").textContent).toBe("?tab=executions&symbol=BT");

    await user.click(screen.getByRole("button", { name: "back" }));
    expect(screen.getByTestId("search").textContent).toBe("");
    expect(screen.getByTestId("tab")).toHaveTextContent("orders");
  });
});
