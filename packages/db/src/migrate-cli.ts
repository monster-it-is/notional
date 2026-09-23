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
      cli.writeError(
        formatMigrationError(closeError, "failed to close the database pool"),
      );
    }
  }

  if (failure !== undefined) {
    cli.writeError(formatMigrationError(failure, "migration failed"));
    return 1;
  }

  return 0;
}

const MAX_CAUSE_DEPTH = 5;

function formatMigrationError(error: unknown, fallback: string): string {
  return `${renderError(error, fallback, 0, new Set())}\n`;
}

function renderError(
  error: unknown,
  fallback: string,
  depth: number,
  seen: Set<unknown>,
): string {
  if (depth > MAX_CAUSE_DEPTH) {
    return "name: (truncated)";
  }

  if (typeof error === "string") {
    return `message: ${redact(error)}`;
  }

  if (!isErrorLike(error)) {
    return fallback;
  }

  if (seen.has(error)) {
    return "name: (circular)";
  }
  seen.add(error);

  const lines = [
    `name: ${readName(error)}`,
    `message: ${redact(error.message)}`,
  ];
  const code = readCode(error);
  if (code !== undefined) {
    lines.push(`code: ${code}`);
  }

  if (error.cause !== undefined) {
    lines.push("cause:");
    lines.push(
      indent(renderError(error.cause, "unknown cause", depth + 1, seen)),
    );
  }

  if (depth === 0 && typeof error.stack === "string" && error.stack !== "") {
    lines.push(`stack: ${redact(error.stack)}`);
  }

  return lines.join("\n");
}

function isErrorLike(error: unknown): error is {
  name?: unknown;
  message: string;
  stack?: unknown;
  cause?: unknown;
  code?: unknown;
} {
  return (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  );
}

function readName(error: object): string {
  const constructorName = error.constructor?.name;
  if (isName(constructorName) && constructorName !== "Error") {
    return constructorName;
  }

  if ("name" in error && isName(error.name)) {
    return error.name;
  }

  return "Error";
}

function readCode(error: object): string | undefined {
  if (!("code" in error) || typeof error.code !== "string") {
    return undefined;
  }

  if (!/^[A-Za-z0-9_]{1,64}$/.test(error.code)) {
    return undefined;
  }

  return error.code;
}

function isName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value) &&
    value !== "Object"
  );
}

function indent(value: string): string {
  return value
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

function redact(value: string): string {
  return value
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s'"]+/gi, "[redacted]")
    .replace(
      /\b(?:password|passwd|pwd|secret|token|DATABASE_URL|MIGRATION_DATABASE_URL)\b\s*[:=]\s*\S+/gi,
      "[redacted]",
    );
}
