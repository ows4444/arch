import { RateLimitGuard } from './rate-limit.guard';
import { TooManyRequestsError } from '../errors/too-many-requests.error';

describe('RateLimitGuard', () => {
  function setup(metadata: unknown) {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(metadata),
    };
    const limiter = { consume: jest.fn() };
    const guard = new RateLimitGuard(reflector as never, limiter as never);

    const setHeader = jest.fn();
    const request = { ip: '1.2.3.4' };
    const context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({ setHeader }),
      }),
    };

    return { guard, reflector, limiter, context, setHeader, request };
  }

  it('is a no-op when the route has no @RateLimit() metadata', async () => {
    const { guard, context, limiter } = setup(undefined);

    await expect(guard.canActivate(context as never)).resolves.toBe(true);
    expect(limiter.consume).not.toHaveBeenCalled();
  });

  it('consumes quota keyed by the request IP by default', async () => {
    const { guard, context, limiter, setHeader } = setup({
      limiterName: 'login',
    });
    limiter.consume.mockResolvedValue({
      allowed: true,
      limit: 5,
      remaining: 4,
      resetAt: new Date(Date.now() + 60_000),
    });

    await expect(guard.canActivate(context as never)).resolves.toBe(true);

    expect(limiter.consume).toHaveBeenCalledWith('login', '1.2.3.4', {});
    expect(setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 5);
    expect(setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 4);
  });

  it('also sets the IETF-draft RateLimit-* headers alongside the informal X-RateLimit-* ones', async () => {
    const { guard, context, limiter, setHeader } = setup({
      limiterName: 'login',
    });
    limiter.consume.mockResolvedValue({
      allowed: true,
      limit: 5,
      remaining: 4,
      resetAt: new Date(Date.now() + 30_000),
    });

    await guard.canActivate(context as never);

    expect(setHeader).toHaveBeenCalledWith('RateLimit-Limit', 5);
    expect(setHeader).toHaveBeenCalledWith('RateLimit-Remaining', 4);
    expect(setHeader).toHaveBeenCalledWith(
      'RateLimit-Reset',
      expect.any(Number),
    );
  });

  it('uses a custom keyBy extractor when provided', async () => {
    const keyBy = jest.fn().mockReturnValue('custom-key');
    const { guard, context, limiter } = setup({ limiterName: 'login', keyBy });
    limiter.consume.mockResolvedValue({
      allowed: true,
      limit: 5,
      remaining: 4,
      resetAt: new Date(),
    });

    await guard.canActivate(context as never);

    expect(keyBy).toHaveBeenCalledWith({ ip: '1.2.3.4' });
    expect(limiter.consume).toHaveBeenCalledWith('login', 'custom-key', {});
  });

  it('throws TooManyRequestsError and sets Retry-After when the limit is exceeded', async () => {
    const { guard, context, limiter, setHeader } = setup({
      limiterName: 'login',
    });
    limiter.consume.mockResolvedValue({
      allowed: false,
      limit: 5,
      remaining: 0,
      resetAt: new Date(Date.now() + 30_000),
    });

    await expect(guard.canActivate(context as never)).rejects.toThrow(
      TooManyRequestsError,
    );
    expect(setHeader).toHaveBeenCalledWith('Retry-After', expect.any(Number));
  });

  it('bypasses limiting entirely when skip() returns true', async () => {
    const skip = jest.fn().mockReturnValue(true);
    const { guard, context, limiter } = setup({ limiterName: 'login', skip });

    await expect(guard.canActivate(context as never)).resolves.toBe(true);

    expect(skip).toHaveBeenCalledWith({ ip: '1.2.3.4' });
    expect(limiter.consume).not.toHaveBeenCalled();
  });

  it('bypasses limiting when the resolved key is on the allowlist', async () => {
    const { guard, context, limiter } = setup({
      limiterName: 'login',
      allowlist: ['1.2.3.4'],
    });

    await expect(guard.canActivate(context as never)).resolves.toBe(true);

    expect(limiter.consume).not.toHaveBeenCalled();
  });

  it('does not bypass limiting when the resolved key is not on the allowlist', async () => {
    const { guard, context, limiter } = setup({
      limiterName: 'login',
      allowlist: ['9.9.9.9'],
    });
    limiter.consume.mockResolvedValue({
      allowed: true,
      limit: 5,
      remaining: 4,
      resetAt: new Date(),
    });

    await guard.canActivate(context as never);

    expect(limiter.consume).toHaveBeenCalledWith('login', '1.2.3.4', {});
  });

  it('rejects immediately when the resolved key is on the denylist, without consuming quota', async () => {
    const { guard, context, limiter, setHeader } = setup({
      limiterName: 'login',
      denylist: ['1.2.3.4'],
    });

    await expect(guard.canActivate(context as never)).rejects.toThrow(
      TooManyRequestsError,
    );

    expect(limiter.consume).not.toHaveBeenCalled();
    expect(setHeader).toHaveBeenCalledWith('Retry-After', 3600);
  });
});
