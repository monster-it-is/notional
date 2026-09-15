import { useEffect } from "react";

import { getMarketSocket } from "../realtime/runtime.ts";

export function useMarketSocket(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const socket = getMarketSocket();
    socket.acquire();
    return () => {
      socket.release();
    };
  }, [enabled]);
}
