import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

if (!process.env.TEST_DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL is not defined");
}

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.NODE_ENV = "test";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    globalSetup: resolve(import.meta.dirname, "../../packages/db/vitest.global-setup.ts"),
    fileParallelism: false,
  },
});
