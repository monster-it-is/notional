import { runMigrationCli } from "./migrate-cli.js";
import { closeMigrationPool, runMigrations } from "./migrate.js";

const code = await runMigrationCli({
  run: runMigrations,
  close: closeMigrationPool,
  writeError(message) {
    process.stderr.write(message);
  },
});

if (code !== 0) {
  process.exitCode = code;
}
