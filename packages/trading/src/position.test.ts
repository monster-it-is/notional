import { describe, expect, it } from "vitest";

import {
  applyFillToPosition,
  classifyPositionTransition,
  positionSide,
  signedFillQuantity,
} from "./position.js";
import type { ApplyFillInput, ApplyFillResult, PositionTransition } from "./position.js";
import { expectTradingCode } from "./test-helpers.js";

type FillCase = {
  name: string;
  input: ApplyFillInput;
  expected: Pick<
    ApplyFillResult,
    | "nextQty"
    | "nextEntryPrice"
    | "realizedPnl"
    | "closedQty"
    | "openedQty"
    | "transition"
  >;
};

const TRUTH_TABLE: FillCase[] = [
  {
    name: "FLAT + BUY",
    input: {
      currentQty: "0",
      currentEntryPrice: null,
      fillSide: "BUY",
      fillQty: "2",
      fillPrice: "100",
    },
    expected: {
      nextQty: "2",
      nextEntryPrice: "100",
      realizedPnl: "0",
      closedQty: "0",
      openedQty: "2",
      transition: "OPEN",
    },
  },
  {
    name: "FLAT + SELL",
    input: {
      currentQty: "0",
      currentEntryPrice: null,
      fillSide: "SELL",
      fillQty: "2",
      fillPrice: "100",
    },
    expected: {
      nextQty: "-2",
      nextEntryPrice: "100",
      realizedPnl: "0",
      closedQty: "0",
      openedQty: "2",
      transition: "OPEN",
    },
  },
  {
    name: "LONG + BUY increase",
    input: {
      currentQty: "1",
      currentEntryPrice: "100",
      fillSide: "BUY",
      fillQty: "2",
      fillPrice: "130",
    },
    expected: {
      nextQty: "3",
      nextEntryPrice: "120",
      realizedPnl: "0",
      closedQty: "0",
      openedQty: "2",
      transition: "INCREASE",
    },
  },
  {
    name: "LONG + smaller SELL reduce",
    input: {
      currentQty: "3",
      currentEntryPrice: "120",
      fillSide: "SELL",
      fillQty: "1",
      fillPrice: "150",
    },
    expected: {
      nextQty: "2",
      nextEntryPrice: "120",
      realizedPnl: "30",
      closedQty: "1",
      openedQty: "0",
      transition: "REDUCE",
    },
  },
  {
    name: "LONG + equal SELL close",
    input: {
      currentQty: "2",
      currentEntryPrice: "120",
      fillSide: "SELL",
      fillQty: "2",
      fillPrice: "110",
    },
    expected: {
      nextQty: "0",
      nextEntryPrice: null,
      realizedPnl: "-20",
      closedQty: "2",
      openedQty: "0",
      transition: "CLOSE",
    },
  },
  {
    name: "LONG + larger SELL reverse",
    input: {
      currentQty: "2",
      currentEntryPrice: "100",
      fillSide: "SELL",
      fillQty: "3",
      fillPrice: "120",
    },
    expected: {
      nextQty: "-1",
      nextEntryPrice: "120",
      realizedPnl: "40",
      closedQty: "2",
      openedQty: "1",
      transition: "REVERSE",
    },
  },
  {
    name: "SHORT + SELL increase",
    input: {
      currentQty: "-1",
      currentEntryPrice: "100",
      fillSide: "SELL",
      fillQty: "3",
      fillPrice: "80",
    },
    expected: {
      nextQty: "-4",
      nextEntryPrice: "85",
      realizedPnl: "0",
      closedQty: "0",
      openedQty: "3",
      transition: "INCREASE",
    },
  },
  {
    name: "SHORT + smaller BUY reduce",
    input: {
      currentQty: "-2",
      currentEntryPrice: "100",
      fillSide: "BUY",
      fillQty: "1",
      fillPrice: "80",
    },
    expected: {
      nextQty: "-1",
      nextEntryPrice: "100",
      realizedPnl: "20",
      closedQty: "1",
      openedQty: "0",
      transition: "REDUCE",
    },
  },
  {
    name: "SHORT + equal BUY close",
    input: {
      currentQty: "-2",
      currentEntryPrice: "100",
      fillSide: "BUY",
      fillQty: "2",
      fillPrice: "90",
    },
    expected: {
      nextQty: "0",
      nextEntryPrice: null,
      realizedPnl: "20",
      closedQty: "2",
      openedQty: "0",
      transition: "CLOSE",
    },
  },
  {
    name: "SHORT + larger BUY reverse",
    input: {
      currentQty: "-2",
      currentEntryPrice: "100",
      fillSide: "BUY",
      fillQty: "3",
      fillPrice: "80",
    },
    expected: {
      nextQty: "1",
      nextEntryPrice: "80",
      realizedPnl: "40",
      closedQty: "2",
      openedQty: "1",
      transition: "REVERSE",
    },
  },
];

describe("signed position convention", () => {
  it("derives LONG/SHORT/FLAT from signed quantity", () => {
    expect(positionSide("2")).toBe("LONG");
    expect(positionSide("-2")).toBe("SHORT");
    expect(positionSide("0")).toBe("FLAT");
    expect(positionSide("-0")).toBe("FLAT");
  });

  it("maps BUY to a positive fill and SELL to a negative fill", () => {
    expect(signedFillQuantity("BUY", "1.5")).toBe("1.5");
    expect(signedFillQuantity("SELL", "1.5")).toBe("-1.5");
  });
});

describe("applyFillToPosition truth table", () => {
  it.each(TRUTH_TABLE)("$name", ({ input, expected }) => {
    const result = applyFillToPosition(input);

    expect(result.previousQty).toBe(input.currentQty === "-0" ? "0" : input.currentQty);
    expect(result.previousEntryPrice).toBe(input.currentEntryPrice);
    expect(result.nextQty).toBe(expected.nextQty);
    expect(result.nextEntryPrice).toBe(expected.nextEntryPrice);
    expect(result.realizedPnl).toBe(expected.realizedPnl);
    expect(result.closedQty).toBe(expected.closedQty);
    expect(result.openedQty).toBe(expected.openedQty);
    expect(result.transition).toBe(expected.transition);
    expect(classifyPositionTransition({
      currentQty: input.currentQty,
      fillSide: input.fillSide,
      fillQty: input.fillQty,
    })).toBe(expected.transition);
  });
});

describe("applyFillToPosition additional cases", () => {
  it("keeps entry unchanged on a losing long reduce", () => {
    const result = applyFillToPosition({
      currentQty: "3",
      currentEntryPrice: "120",
      fillSide: "SELL",
      fillQty: "1",
      fillPrice: "90",
    });
    expect(result.transition).toBe("REDUCE");
    expect(result.nextQty).toBe("2");
    expect(result.nextEntryPrice).toBe("120");
    expect(result.realizedPnl).toBe("-30");
  });

  it("keeps entry unchanged on a losing short reduce", () => {
    const result = applyFillToPosition({
      currentQty: "-2",
      currentEntryPrice: "100",
      fillSide: "BUY",
      fillQty: "1",
      fillPrice: "120",
    });
    expect(result.transition).toBe("REDUCE");
    expect(result.nextQty).toBe("-1");
    expect(result.nextEntryPrice).toBe("100");
    expect(result.realizedPnl).toBe("-20");
  });

  it("closes a profitable short to canonical flat", () => {
    const result = applyFillToPosition({
      currentQty: "-2",
      currentEntryPrice: "100",
      fillSide: "BUY",
      fillQty: "2",
      fillPrice: "90",
    });
    expect(result.transition).toBe("CLOSE");
    expect(result.nextQty).toBe("0");
    expect(result.nextEntryPrice).toBeNull();
    expect(result.realizedPnl).toBe("20");
  });

  it("handles fractional quantities and prices", () => {
    const result = applyFillToPosition({
      currentQty: "0.5",
      currentEntryPrice: "100.25",
      fillSide: "BUY",
      fillQty: "0.25",
      fillPrice: "100.25",
    });
    expect(result.transition).toBe("INCREASE");
    expect(result.nextQty).toBe("0.75");
    expect(result.nextEntryPrice).toBe("100.25");
    expect(result.realizedPnl).toBe("0");
  });

  it("does not blend the old entry into a reversed position", () => {
    const result = applyFillToPosition({
      currentQty: "2",
      currentEntryPrice: "100",
      fillSide: "SELL",
      fillQty: "3",
      fillPrice: "120",
    });
    expect(result.transition).toBe("REVERSE");
    expect(result.nextEntryPrice).toBe("120");
    expect(result.nextQty).toBe("-1");
  });

  it("canonicalizes close-through-zero nextQty to 0 not -0", () => {
    const result = applyFillToPosition({
      currentQty: "-2",
      currentEntryPrice: "100",
      fillSide: "BUY",
      fillQty: "2",
      fillPrice: "100",
    });
    expect(result.nextQty).toBe("0");
    expect(result.nextQty).not.toBe("-0");
    expect(result.realizedPnl).toBe("0");
  });

  it("rejects inconsistent position state", () => {
    expectTradingCode(
      () =>
        applyFillToPosition({
          currentQty: "0",
          currentEntryPrice: "100",
          fillSide: "BUY",
          fillQty: "1",
          fillPrice: "100",
        }),
      "INVARIANT_VIOLATION",
    );
    expectTradingCode(
      () =>
        applyFillToPosition({
          currentQty: "1",
          currentEntryPrice: null,
          fillSide: "BUY",
          fillQty: "1",
          fillPrice: "100",
        }),
      "INVARIANT_VIOLATION",
    );
    expectTradingCode(
      () =>
        applyFillToPosition({
          currentQty: "1",
          currentEntryPrice: "0",
          fillSide: "BUY",
          fillQty: "1",
          fillPrice: "100",
        }),
      "INVARIANT_VIOLATION",
    );
  });

  it("rejects non-positive fills and prices", () => {
    expectTradingCode(
      () =>
        applyFillToPosition({
          currentQty: "0",
          currentEntryPrice: null,
          fillSide: "BUY",
          fillQty: "0",
          fillPrice: "100",
        }),
      "INVALID_ARGUMENT",
    );
    expectTradingCode(
      () =>
        applyFillToPosition({
          currentQty: "0",
          currentEntryPrice: null,
          fillSide: "BUY",
          fillQty: "1",
          fillPrice: "0",
        }),
      "INVALID_ARGUMENT",
    );
  });
});

describe("classifyPositionTransition", () => {
  it("is shared with applyFillToPosition for reduceOnly prevalidation", () => {
    const expected: Array<{
      currentQty: string;
      fillSide: "BUY" | "SELL";
      fillQty: string;
      transition: PositionTransition;
    }> = [
      { currentQty: "0", fillSide: "BUY", fillQty: "1", transition: "OPEN" },
      { currentQty: "2", fillSide: "BUY", fillQty: "1", transition: "INCREASE" },
      { currentQty: "2", fillSide: "SELL", fillQty: "1", transition: "REDUCE" },
      { currentQty: "2", fillSide: "SELL", fillQty: "2", transition: "CLOSE" },
      { currentQty: "2", fillSide: "SELL", fillQty: "3", transition: "REVERSE" },
    ];

    for (const row of expected) {
      expect(classifyPositionTransition(row)).toBe(row.transition);
    }
  });
});
