import { DatabaseRole } from '../constants/database-role.enum';
import { RepositoryClass } from '../interfaces/repository-class.interface';

export const DATABASE_REPOSITORY_METADATA = Symbol(
  'DATABASE_REPOSITORY_METADATA',
);

const TOKENS = new Map<string, symbol>();

export function getRepositoryToken(
  repository: RepositoryClass,
  role: DatabaseRole,
): symbol {
  const key = `${repository.name}:${role}`;

  let token = TOKENS.get(key);

  if (!token) {
    token = Symbol(key);

    TOKENS.set(key, token);
  }

  return token;
}
