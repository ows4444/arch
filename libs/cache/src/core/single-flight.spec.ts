import { SingleFlight } from './single-flight';

describe('SingleFlight', () => {
  it('runs the function and returns its result', async () => {
    const singleFlight = new SingleFlight<string>();

    await expect(
      singleFlight.do('key', () => Promise.resolve(42)),
    ).resolves.toBe(42);
  });

  it('coalesces concurrent calls for the same key into a single invocation', async () => {
    const singleFlight = new SingleFlight<string>();
    const fn = jest.fn().mockResolvedValue('result');

    const [a, b, c] = await Promise.all([
      singleFlight.do('key', fn),
      singleFlight.do('key', fn),
      singleFlight.do('key', fn),
    ]);

    expect(fn).toHaveBeenCalledTimes(1);
    expect([a, b, c]).toEqual(['result', 'result', 'result']);
  });

  it('does not coalesce calls for different keys', async () => {
    const singleFlight = new SingleFlight<string>();
    const fn = jest.fn().mockResolvedValue('result');

    await Promise.all([singleFlight.do('a', fn), singleFlight.do('b', fn)]);

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('removes the key from in-flight tracking once settled, allowing a fresh call', async () => {
    const singleFlight = new SingleFlight<string>();
    const fn = jest.fn().mockResolvedValue('result');

    await singleFlight.do('key', fn);
    expect(singleFlight.size()).toBe(0);

    await singleFlight.do('key', fn);

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('removes the key from in-flight tracking even when the function rejects', async () => {
    const singleFlight = new SingleFlight<string>();
    const error = new Error('boom');

    await expect(
      singleFlight.do('key', () => Promise.reject(error)),
    ).rejects.toThrow('boom');

    expect(singleFlight.size()).toBe(0);
  });

  it('propagates the same rejection to all coalesced callers', async () => {
    const singleFlight = new SingleFlight<string>();
    const error = new Error('boom');
    const fn = jest.fn().mockRejectedValue(error);

    const results = await Promise.allSettled([
      singleFlight.do('key', fn),
      singleFlight.do('key', fn),
    ]);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(results).toEqual([
      { status: 'rejected', reason: error },
      { status: 'rejected', reason: error },
    ]);
  });
});
