export function postgresConstraint(error: unknown): string | undefined {
  let current: unknown = error;

  while (current && typeof current === "object") {
    if ("constraint" in current && typeof current.constraint === "string") {
      return current.constraint;
    }

    current = "cause" in current ? current.cause : undefined;
  }

  return undefined;
}
