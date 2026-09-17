import { describe, expect, it } from "vitest";

import {
  futureFundingTimeFrom,
  getDatabaseNow,
  liveScheduleProofFrom,
} from "./funding-test-fixtures.js";

describe("funding test live-schedule fixture", () => {
  it("produces nextFundingTime after PostgreSQL clock_timestamp at proof creation", async () => {
    const databaseNow = await getDatabaseNow();
    const nextFundingTime = futureFundingTimeFrom(databaseNow);
    const proof = liveScheduleProofFrom({
      validFrom: databaseNow,
      observedAt: databaseNow,
      nextFundingTime,
    });
    const sampledAgain = await getDatabaseNow();

    expect(Date.parse(proof.nextFundingTime)).toBeGreaterThan(databaseNow.getTime());
    expect(Date.parse(proof.nextFundingTime)).toBeGreaterThan(sampledAgain.getTime());
  });
});
