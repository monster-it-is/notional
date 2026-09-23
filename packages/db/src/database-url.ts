export function applicationDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const url = env.DATABASE_URL;
  if (url === undefined || url === "") {
    throw new Error("DATABASE_URL is not defined");
  }
  return url;
}

export function migrationDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const url = env.MIGRATION_DATABASE_URL;
  if (url !== undefined && url !== "") {
    return url;
  }
  return applicationDatabaseUrl(env);
}
