import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    conditions: ["development", "import", "module", "default"],
  },
  test: {},
});
