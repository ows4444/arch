import { requestContext } from './request-context';

describe('requestContext', () => {
  it('has no current context outside of run()', () => {
    expect(requestContext.current).toBeUndefined();
    expect(requestContext.requestId).toBeUndefined();
  });

  it('exposes the requestId inside run()', () => {
    requestContext.run({ requestId: 'req-1' }, () => {
      expect(requestContext.current).toEqual({ requestId: 'req-1' });
      expect(requestContext.requestId).toBe('req-1');
    });
  });

  it('clears the context once run() returns', () => {
    requestContext.run({ requestId: 'req-1' }, () => undefined);

    expect(requestContext.requestId).toBeUndefined();
  });

  it('propagates across an async/await chain inside run()', async () => {
    await requestContext.run({ requestId: 'req-async' }, async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(requestContext.requestId).toBe('req-async');
    });
  });

  it('keeps two concurrent run() calls isolated from each other', async () => {
    const seenIds: string[] = [];

    await Promise.all([
      requestContext.run({ requestId: 'req-a' }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        seenIds.push(requestContext.requestId!);
      }),
      requestContext.run({ requestId: 'req-b' }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        seenIds.push(requestContext.requestId!);
      }),
    ]);

    expect(seenIds.sort()).toEqual(['req-a', 'req-b']);
  });

  it('returns the callback result', () => {
    const result = requestContext.run({ requestId: 'req-1' }, () => 42);

    expect(result).toBe(42);
  });
});
