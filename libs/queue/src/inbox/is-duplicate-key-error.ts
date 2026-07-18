import { QueryFailedError } from 'typeorm';

interface QueryDriverError {
  code?: string;
}

/**
 * Postgres/SQLite codes are handled alongside MySQL's `ER_DUP_ENTRY` because
 * `testing/queue-test-datasource.ts` runs the same repository code against
 * an in-memory SQLite datasource in unit tests; production only ever uses
 * MySQL.
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
