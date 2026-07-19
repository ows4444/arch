import { CacheAccessTokenDenylist } from './cache-access-token-denylist';

describe('CacheAccessTokenDenylist', () => {
  function setup() {
    const cacheManager = {
      get: jest.fn(),
      set: jest.fn().mockResolvedValue(undefined),
    };
    const denylist = new CacheAccessTokenDenylist(
      cacheManager as never,
      'auth-cache',
    );

    return { denylist, cacheManager };
  }

  it('defaults to the "default" cache when none is given', async () => {
    const cacheManager = { get: jest.fn(), set: jest.fn() };
    const denylist = new CacheAccessTokenDenylist(cacheManager as never);

    await denylist.isDenied('jti-1');

    expect(cacheManager.get).toHaveBeenCalledWith(
      'default',
      'auth:denylist:jti-1',
    );
  });

  it('denies a jti with a ttl matching the remaining time until expiry', async () => {
    const { denylist, cacheManager } = setup();
    const expiresAt = new Date(Date.now() + 60_000);

    await denylist.deny('jti-1', expiresAt);

    expect(cacheManager.set).toHaveBeenCalledWith(
      'auth-cache',
      'auth:denylist:jti-1',
      true,
      expect.any(Number),
    );
    const call = cacheManager.set.mock.calls[0] as unknown as [
      string,
      string,
      boolean,
      number,
    ];
    const ttlArg = call[3];
    expect(ttlArg).toBeGreaterThan(0);
    expect(ttlArg).toBeLessThanOrEqual(60_000);
  });

  it('does not cache an already-expired token', async () => {
    const { denylist, cacheManager } = setup();

    await denylist.deny('jti-1', new Date(Date.now() - 1000));

    expect(cacheManager.set).not.toHaveBeenCalled();
  });

  it('reports isDenied true when the cache holds the key', async () => {
    const { denylist, cacheManager } = setup();
    cacheManager.get.mockResolvedValue(true);

    await expect(denylist.isDenied('jti-1')).resolves.toBe(true);
    expect(cacheManager.get).toHaveBeenCalledWith(
      'auth-cache',
      'auth:denylist:jti-1',
    );
  });

  it('reports isDenied false when the cache does not hold the key', async () => {
    const { denylist, cacheManager } = setup();
    cacheManager.get.mockResolvedValue(undefined);

    await expect(denylist.isDenied('jti-1')).resolves.toBe(false);
  });
});
