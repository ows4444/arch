import { Logger } from '@nestjs/common';
import { retry } from './retry.util';

describe('retry', () => {
  it('returns the result on the first successful attempt without retrying', async () => {
    const operation = jest.fn().mockResolvedValue('ok');

    await expect(
      retry(operation, { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 10 }),
    ).resolves.toBe('ok');

    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('retries after a failure and returns the eventual success', async () => {
    const operation = jest
      .fn()
      .mockRejectedValueOnce(new Error('first attempt failed'))
      .mockResolvedValueOnce('recovered');

    await expect(
      retry(operation, { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 10 }),
    ).resolves.toBe('recovered');

    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('stops after maxAttempts and throws the last error', async () => {
    const errors = [new Error('e1'), new Error('e2'), new Error('e3')];
    const operation = jest
      .fn()
      .mockRejectedValueOnce(errors[0])
      .mockRejectedValueOnce(errors[1])
      .mockRejectedValueOnce(errors[2]);

    await expect(
      retry(operation, { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 10 }),
    ).rejects.toBe(errors[2]);

    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('does not sleep after the final failed attempt (fails fast, no wasted delay)', async () => {
    const operation = jest.fn().mockRejectedValue(new Error('always fails'));
    const started = Date.now();

    await expect(
      retry(operation, {
        maxAttempts: 1,
        initialDelayMs: 10_000,
        maxDelayMs: 10_000,
      }),
    ).rejects.toThrow('always fails');

    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('logs each failed attempt via Logger.debug, including AggregateError causes', async () => {
    const debugSpy = jest.spyOn(Logger, 'debug').mockImplementation();
    const aggregate = new AggregateError(
      [new Error('cause-a'), new Error('cause-b')],
      'combined failure',
    );
    const operation = jest
      .fn()
      .mockRejectedValueOnce(aggregate)
      .mockResolvedValueOnce('ok');

    await retry(operation, {
      maxAttempts: 2,
      initialDelayMs: 1,
      maxDelayMs: 10,
    });

    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining('cause-a'),
      'DatabaseRetry',
    );

    debugSpy.mockRestore();
  });
});
