import { DatabaseRole } from '../constants/database-role.enum';
import { getDatabaseAccessorToken } from './datasource.tokens';

describe('getDatabaseAccessorToken', () => {
  it('returns the identical symbol across separate calls for the same role', () => {
    const first = getDatabaseAccessorToken(DatabaseRole.READ);
    const second = getDatabaseAccessorToken(DatabaseRole.READ);

    expect(first).toBe(second);
  });

  it('returns distinct symbols for different roles', () => {
    const read = getDatabaseAccessorToken(DatabaseRole.READ);
    const write = getDatabaseAccessorToken(DatabaseRole.WRITE);

    expect(read).not.toBe(write);
  });

  it('does not intern into the process-wide global symbol registry (regression)', () => {
    const token = getDatabaseAccessorToken(DatabaseRole.WRITE);

    expect(Symbol.for(`DATABASE_ACCESSOR:${DatabaseRole.WRITE}`)).not.toBe(
      token,
    );
    expect(Symbol.keyFor(token)).toBeUndefined();
  });
});
