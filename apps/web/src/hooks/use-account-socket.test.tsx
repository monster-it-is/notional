import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useAccountSocket } from "./use-account-socket.ts";

const { acquire, release } = vi.hoisted(() => ({
  acquire: vi.fn(),
  release: vi.fn(),
}));

vi.mock("../realtime/runtime.ts", () => ({
  getAccountSocket: () => ({ acquire, release }),
}));

describe("useAccountSocket", () => {
  it("does not acquire until ready is true", () => {
    const { rerender } = renderHook((ready: boolean) => useAccountSocket(ready), {
      initialProps: false,
    });

    expect(acquire).not.toHaveBeenCalled();
    rerender(true);
    expect(acquire).toHaveBeenCalledTimes(1);
  });
});
