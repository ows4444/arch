import { DatabaseRole } from '../constants/database-role.enum';

export function getDatabaseAccessorToken(role: DatabaseRole): symbol {
  return Symbol.for(`DATABASE_ACCESSOR:${role}`);
}
