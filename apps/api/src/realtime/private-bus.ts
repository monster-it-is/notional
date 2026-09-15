import { randomUUID } from "node:crypto";

import type { PrivateInvalidateMessage } from "@notional/contracts";

import type { Clock } from "../market-data/types.js";
import { MAX_PRIVATE_CONNECTIONS_PER_ACCOUNT, PRIVATE_BACKPRESSURE_BYTES } from "./constants.js";
import type { CommittedPrivateEffect } from "./effects.js";

export type AccountClient = {
  id: string;
  paperAccountId: string;
  attachedAt: number;
  bufferedAmount(): number;
  sendJson(payload: unknown): void;
  close(code: number, reason: string): void;
};

export type PrivateEventBus = {
  add(client: AccountClient): void;
  remove(client: AccountClient): void;
  publish(effect: CommittedPrivateEffect): void;
  list(paperAccountId: string): AccountClient[];
  shutdown(): void;
};

export function createPrivateEventBus(options: {
  clock: Clock;
  backpressureBytes?: number;
  maxConnectionsPerAccount?: number;
}): PrivateEventBus {
  const backpressureBytes = options.backpressureBytes ?? PRIVATE_BACKPRESSURE_BYTES;
  const maxConnections =
    options.maxConnectionsPerAccount ?? MAX_PRIVATE_CONNECTIONS_PER_ACCOUNT;
  const byAccount = new Map<string, AccountClient[]>();
  let stopped = false;

  function clientsFor(paperAccountId: string): AccountClient[] {
    return byAccount.get(paperAccountId) ?? [];
  }

  return {
    add(client) {
      if (stopped) {
        client.close(1001, "SHUTDOWN");
        return;
      }

      const existing = clientsFor(client.paperAccountId);

      if (existing.length >= maxConnections) {
        const oldest = existing.shift();
        oldest?.close(1008, "CONNECTION_LIMIT");
      }

      existing.push(client);
      byAccount.set(client.paperAccountId, existing);
    },
    remove(client) {
      const existing = clientsFor(client.paperAccountId);
      const next = existing.filter((row) => row.id !== client.id);

      if (next.length === 0) {
        byAccount.delete(client.paperAccountId);
        return;
      }

      byAccount.set(client.paperAccountId, next);
    },
    publish(effect) {
      if (stopped) {
        return;
      }

      const event: PrivateInvalidateMessage = {
        type: "private.invalidate",
        eventId: randomUUID(),
        occurredAt: new Date(options.clock.now()).toISOString(),
        resources: effect.resources,
        reason: effect.reason,
      };

      for (const client of [...clientsFor(effect.paperAccountId)]) {
        try {
          if (client.bufferedAmount() > backpressureBytes) {
            client.close(4429, "PRIVATE_BACKPRESSURE");
            continue;
          }

          client.sendJson(event);
        } catch {
          try {
            client.close(4429, "PRIVATE_BACKPRESSURE");
          } catch {
            // Ignore close failures on a dead socket.
          }
        }
      }
    },
    list(paperAccountId) {
      return [...clientsFor(paperAccountId)];
    },
    shutdown() {
      stopped = true;

      for (const clients of byAccount.values()) {
        for (const client of clients) {
          try {
            client.close(1001, "SHUTDOWN");
          } catch {
            // Ignore close failures during shutdown.
          }
        }
      }

      byAccount.clear();
    },
  };
}
