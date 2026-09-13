import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "./schema/index.js";

type Database = NodePgDatabase<typeof schema>;

export type FinancialExecutor = Pick<Database, "insert" | "select" | "update">;

export type FinancialTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];
