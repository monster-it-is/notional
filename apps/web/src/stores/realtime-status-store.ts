import type { ConnectionStatus } from "../realtime/reconnect.ts";
import { create } from "zustand";

export const useRealtimeStatusStore = create<{
  account: ConnectionStatus;
  market: ConnectionStatus;
  setAccount: (status: ConnectionStatus) => void;
  setMarket: (status: ConnectionStatus) => void;
}>((set) => ({
  account: "idle",
  market: "idle",
  setAccount: (account) => set({ account }),
  setMarket: (market) => set({ market }),
}));
