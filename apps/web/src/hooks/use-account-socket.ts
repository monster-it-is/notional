import { useEffect } from "react";

import { getAccountSocket } from "../realtime/runtime.ts";

export function useAccountSocket(ready: boolean): void {
  useEffect(() => {
    if (!ready) {
      return;
    }

    const socket = getAccountSocket();
    socket.acquire();
    return () => {
      socket.release();
    };
  }, [ready]);
}
