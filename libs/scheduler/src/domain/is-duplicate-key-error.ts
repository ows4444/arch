import { QueryFailedError } from 'typeorm';

interface QueryDriverError {
  code?: string;
}

/**
 * Local copy of the same check every sibling lib
 * (`libs/auth`/`libs/users`/`libs/organizations`/`libs/queue`/`libs/workflow`)
 * keeps its own copy of, per that precedent — narrow, dialect-detail utility,
 * not worth centralizing across libs (CLAUDE.md: "shared utilities only when
 * justified").
 */
export function isDuplicateKeyError(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) {
    return false;
  }

  const driverError = error.driverError as QueryDriverError | undefined;

  if (
    typeof driverError !== 'object' ||
    driverError === null ||
    !('code' in driverError)
  ) {
    return false;
  }

  const code = driverError.code;

  return (
    code === 'ER_DUP_ENTRY' || // MySQL
    code === '23505' || // Postgres
    code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || // SQLite
    code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
}
