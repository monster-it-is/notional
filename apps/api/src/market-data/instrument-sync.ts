import {
  db,
  lockExistingInstrumentsForCatalogSync,
  markInstrumentsInactiveExcept,
  upsertInstrumentBySymbol,
  type UpsertInstrumentInput,
} from "@notional/db";

import { mapExchangeInfo } from "./map-exchange-info.js";
import { silentLogger, type Logger } from "./types.js";

export type InstrumentSyncResult =
  | { ok: true; upserted: number; inactivated: number }
  | {
      ok: false;
      reason: "fetch" | "invalid_snapshot" | "malformed_candidate" | "empty" | "transaction";
      detail: string;
    };

export async function syncInstrumentCatalog(options: {
  fetchExchangeInfo: () => Promise<unknown>;
  logger?: Logger;
}): Promise<InstrumentSyncResult> {
  const logger = options.logger ?? silentLogger;
  let payload: unknown;

  try {
    payload = await options.fetchExchangeInfo();
  } catch (error) {
    const detail = error instanceof Error ? error.message : "exchangeInfo fetch failed";
    logger.error("instrument catalog fetch failed", { detail });
    return { ok: false, reason: "fetch", detail };
  }

  const mapped = mapExchangeInfo(payload);

  if (!mapped.ok) {
    logger.error("instrument catalog mapping aborted", {
      reason: mapped.reason,
      detail: mapped.detail,
    });
    return mapped;
  }

  try {
    const inactivated = await persistCatalogSnapshot(mapped.instruments);
    logger.info("instrument catalog synchronized", {
      upserted: mapped.instruments.length,
      inactivated,
    });
    return {
      ok: true,
      upserted: mapped.instruments.length,
      inactivated,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "catalog transaction failed";
    logger.error("instrument catalog transaction failed", { detail });
    return { ok: false, reason: "transaction", detail };
  }
}

async function persistCatalogSnapshot(instruments: UpsertInstrumentInput[]): Promise<number> {
  return db.transaction(async (tx) => {
    await lockExistingInstrumentsForCatalogSync(tx);

    for (const instrument of instruments) {
      await upsertInstrumentBySymbol(tx, instrument);
    }

    return markInstrumentsInactiveExcept(
      tx,
      instruments.map((instrument) => instrument.symbol),
    );
  });
}
