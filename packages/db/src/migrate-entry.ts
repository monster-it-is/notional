import { closePool } from "./client.js";
import { runMigrationCli } from "./migrate-cli.js";
import { runMigrations } from "./migrate.js";

const code = await runMigrationCli({
  run: runMigrations,
  close: closePool,
  writeError(message) {
    process.stderr.write(message);
  },
});

if (code !== 0) {
  process.exitCode = code;
}
