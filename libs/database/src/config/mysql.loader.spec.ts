import { databaseLoader } from './mysql.loader';

const baseEnv = {
  MYSQL_HOST: 'localhost',
  MYSQL_USERNAME: 'user',
  MYSQL_PASSWORD: 'pass',
  MYSQL_DATABASE: 'app',
  MYSQL_PORT: '3306',
  MYSQL_TIME_ZONE: 'UTC',
};

function withEnv<T>(overrides: Record<string, string>, fn: () => T): T {
  const previous = { ...process.env };

  process.env = { ...process.env, ...baseEnv, ...overrides };

  try {
    return fn();
  } finally {
    process.env = previous;
  }
}

describe('databaseLoader', () => {
  it('defaults synchronize to false for the writer when MYSQL_SYNCHRONIZE is unset', () => {
    const config = withEnv({}, () => databaseLoader());

    expect(config.master.synchronize).toBe(false);
  });

  it('enables synchronize for the writer only when MYSQL_SYNCHRONIZE=true', () => {
    const config = withEnv({ MYSQL_SYNCHRONIZE: 'true' }, () =>
      databaseLoader(),
    );

    expect(config.master.synchronize).toBe(true);
  });

  it('treats any non-"true" value as disabled', () => {
    const config = withEnv({ MYSQL_SYNCHRONIZE: 'false' }, () =>
      databaseLoader(),
    );

    expect(config.master.synchronize).toBe(false);
  });

  it('defaults synchronize to false for the replica when MYSQL_REPLICA_SYNCHRONIZE is unset', () => {
    const config = withEnv({}, () => databaseLoader());

    expect(config.replica.synchronize).toBe(false);
  });

  it('enables synchronize for the replica only when MYSQL_REPLICA_SYNCHRONIZE=true', () => {
    const config = withEnv({ MYSQL_REPLICA_SYNCHRONIZE: 'true' }, () =>
      databaseLoader(),
    );

    expect(config.replica.synchronize).toBe(true);
  });

  it('leaves the pool size unset (falls back to the library default) when MYSQL_CONNECTION_LIMIT is unset', () => {
    const config = withEnv({}, () => databaseLoader());

    expect(config.master.poolSize).toBeUndefined();
    expect(config.master.extra).toBeUndefined();
  });

  it('applies MYSQL_CONNECTION_LIMIT to both poolSize and extra.connectionLimit for the writer', () => {
    const config = withEnv({ MYSQL_CONNECTION_LIMIT: '5' }, () =>
      databaseLoader(),
    );

    expect(config.master.poolSize).toBe(5);
    expect(config.master.extra).toEqual({ connectionLimit: 5 });
  });

  it('applies MYSQL_REPLICA_CONNECTION_LIMIT independently for the replica', () => {
    const config = withEnv({ MYSQL_REPLICA_CONNECTION_LIMIT: '7' }, () =>
      databaseLoader(),
    );

    expect(config.replica.poolSize).toBe(7);
    expect(config.master.poolSize).toBeUndefined();
  });

  it('leaves logging unset when MYSQL_LOG_LEVEL is unset', () => {
    const config = withEnv({}, () => databaseLoader());

    expect(config.master.logging).toBeUndefined();
  });

  it.each([
    ['true', true],
    ['false', false],
    ['all', 'all'],
    ['query,error', ['query', 'error']],
  ] as const)('maps MYSQL_LOG_LEVEL=%s to logging=%p', (value, expected) => {
    const config = withEnv({ MYSQL_LOG_LEVEL: value }, () => databaseLoader());

    expect(config.master.logging).toEqual(expected);
  });
});
