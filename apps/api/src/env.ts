import { parseConfiguredMoney, type MoneyDecimal } from "@notional/db";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  WEB_ORIGIN: z.url(),
  FAUCET_AMOUNT: z.string().min(1),
});

export type ApiEnv = Omit<z.infer<typeof envSchema>, "FAUCET_AMOUNT"> & {
  FAUCET_AMOUNT: MoneyDecimal;
};

export function parseEnv(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  const parsed = envSchema.parse(source);

  return {
    ...parsed,
    FAUCET_AMOUNT: parseConfiguredMoney(parsed.FAUCET_AMOUNT),
  };
}

export const env = parseEnv();
