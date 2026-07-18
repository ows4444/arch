import { DatabaseRole } from '../constants/database-role.enum';

// Callers across separate files (DatabaseCoreModule's `provide`,
// InjectDatabase's `@Inject`) need the exact same symbol per role, which is
// why this can't just be `Symbol(...)` on every call. `Symbol.for(...)`
// would also work but interns into Node's *process-wide* global symbol
// registry — any other code anywhere in the process calling
// `Symbol.for('DATABASE_ACCESSOR:write')` would silently collide with this
// token. Caching a plain (non-global) `Symbol()` per role here gives the
// same cross-call identity guarantee without that risk.
const tokens = new Map<DatabaseRole, symbol>();

export function getDatabaseAccessorToken(role: DatabaseRole): symbol {
  let token = tokens.get(role);

  if (!token) {
    token = Symbol(`DATABASE_ACCESSOR:${role}`);
    tokens.set(role, token);
  }

  return token;
}
