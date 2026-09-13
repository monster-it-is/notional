import { config } from "dotenv";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

config({ path: resolve(import.meta.dirname, "../../.env") });

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

export default defineConfig({
  test: {
    globalSetup: "./vitest.global-setup.ts",
    fileParallelism: false,
  },
});
