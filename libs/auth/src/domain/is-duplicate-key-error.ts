import { QueryFailedError } from 'typeorm';

interface QueryDriverError {
  code?: string;
}

/**
 * Same shape as `libs/queue`/`libs/workflow`'s own copies of this check —
 * kept as a local copy rather than a cross-lib import (this is exactly the
 * kind of narrow, dialect-detail utility CLAUDE.md's "shared utilities only
 * when justified" guidance argues against centralizing). Postgres/SQLite
 * codes are handled alongside MySQL's `ER_DUP_ENTRY` because this repo's
 * integration tests run the same repository code against an in-memory
 * SQLite datasource; production only ever uses MySQL.
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
