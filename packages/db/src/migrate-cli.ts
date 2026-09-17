export type MigrationCli = {
  run: () => Promise<void>;
  close: () => Promise<void>;
  writeError: (message: string) => void;
};

export async function runMigrationCli(cli: MigrationCli): Promise<number> {
  let failure: unknown;

  try {
    await cli.run();
  } catch (error: unknown) {
    failure = error;
  }

  try {
    await cli.close();
  } catch (closeError: unknown) {
    if (failure === undefined) {
      failure = closeError;
    } else {
      const detail =
        closeError instanceof Error ? closeError.message : "failed to close the database pool";
      cli.writeError(`${detail}\n`);
    }
  }

  if (failure !== undefined) {
    const detail = failure instanceof Error ? failure.message : "migration failed";
    cli.writeError(`${detail}\n`);
    return 1;
  }

  return 0;
}
