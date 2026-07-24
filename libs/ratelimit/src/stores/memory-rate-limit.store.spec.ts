import { FakeClock } from '@/cache';
import { MemoryRateLimitStore } from './memory-rate-limit.store';

describe('MemoryRateLimitStore', () => {
  it('allows requests up to the limit within a window', async () => {
    const clock = new FakeClock(0);
    const store = new MemoryRateLimitStore(clock);

    for (let i = 0; i < 5; i++) {
      const result = await store.consume('key-1', { limit: 5, windowMs: 1000 });
      expect(result.allowed).toBe(true);
    }

    const sixth = await store.consume('key-1', { limit: 5, windowMs: 1000 });
    expect(sixth.allowed).toBe(false);
    expect(sixth.remaining).toBe(0);
  });

  it('reports decreasing remaining as the window fills up', async () => {
    const clock = new FakeClock(0);
    const store = new MemoryRateLimitStore(clock);

    const first = await store.consume('key-1', { limit: 10, windowMs: 1000 });
    expect(first.remaining).toBe(9);

    const second = await store.consume('key-1', { limit: 10, windowMs: 1000 });
    expect(second.remaining).toBe(8);
  });

  it('does not consume quota for a rejected request', async () => {
    const clock = new FakeClock(0);
    const store = new MemoryRateLimitStore(clock);

    for (let i = 0; i < 3; i++) {
      await store.consume('key-1', { limit: 3, windowMs: 1000 });
    }

    await store.consume('key-1', { limit: 3, windowMs: 1000 }); // rejected
    await store.consume('key-1', { limit: 3, windowMs: 1000 }); // also rejected

    // Near the end of the next window, the prior window's weight has
    // decayed enough that a single new request fits — proving the two
    // rejected calls above never incremented the persisted count (they'd
    // otherwise have pushed the estimate over the limit here too).
    clock.set(1990);
    const result = await store.consume('key-1', { limit: 3, windowMs: 1000 });
    expect(result.allowed).toBe(true);
  });

  it('isolates counters by key', async () => {
    const clock = new FakeClock(0);
    const store = new MemoryRateLimitStore(clock);

    for (let i = 0; i < 3; i++) {
      await store.consume('key-a', { limit: 3, windowMs: 1000 });
    }

    const otherKey = await store.consume('key-b', { limit: 3, windowMs: 1000 });
    expect(otherKey.allowed).toBe(true);
  });

  it('blends the previous window in via the sliding-window-counter weight, not an abrupt reset', async () => {
    const clock = new FakeClock(0);
    const store = new MemoryRateLimitStore(clock);

    // Fill the first window to its limit.
    for (let i = 0; i < 10; i++) {
      await store.consume('key-1', { limit: 10, windowMs: 1000 });
    }

    // Halfway into the next window: previous window's count (10) is
    // weighted at ~50%, so the estimate (~5 + 1) is still comfortably
    // under the limit — a naive fixed-window reset would instead allow a
    // full new burst of 10 immediately at the window boundary.
    clock.set(1500);
    const justAfterBoundary = await store.consume('key-1', {
      limit: 10,
      windowMs: 1000,
    });
    expect(justAfterBoundary.allowed).toBe(true);

    // Far enough into the new window that the previous window's weight has
    // decayed enough to allow filling most of a fresh burst.
    clock.set(1950);
    let allowedCount = 0;
    for (let i = 0; i < 10; i++) {
      const result = await store.consume('key-1', {
        limit: 10,
        windowMs: 1000,
      });
      if (result.allowed) {
        allowedCount++;
      }
    }
    expect(allowedCount).toBeGreaterThan(0);
    expect(allowedCount).toBeLessThan(10);
  });

  it('treats an entry more than one window stale as fresh', async () => {
    const clock = new FakeClock(0);
    const store = new MemoryRateLimitStore(clock);

    for (let i = 0; i < 5; i++) {
      await store.consume('key-1', { limit: 5, windowMs: 1000 });
    }

    clock.set(10_000); // far beyond one window later
    const result = await store.consume('key-1', { limit: 5, windowMs: 1000 });
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  describe('token-bucket algorithm', () => {
    it('starts full and allows an immediate burst up to the limit', async () => {
      const clock = new FakeClock(0);
      const store = new MemoryRateLimitStore(clock);
      const config = {
        limit: 5,
        windowMs: 1000,
        algorithm: 'token-bucket' as const,
      };

      for (let i = 0; i < 5; i++) {
        const result = await store.consume('key-1', config);
        expect(result.allowed).toBe(true);
      }

      const sixth = await store.consume('key-1', config);
      expect(sixth.allowed).toBe(false);
    });

    it('refills continuously over time, not just on window boundaries', async () => {
      const clock = new FakeClock(0);
      const store = new MemoryRateLimitStore(clock);
      const config = {
        limit: 10,
        windowMs: 1000,
        algorithm: 'token-bucket' as const,
      };

      for (let i = 0; i < 10; i++) {
        await store.consume('key-1', config);
      }

      // Half the window has passed — half the bucket should have refilled.
      clock.set(500);
      const result = await store.consume('key-1', config);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeCloseTo(4, 0);
    });

    it('never refills above the configured limit', async () => {
      const clock = new FakeClock(0);
      const store = new MemoryRateLimitStore(clock);
      const config = {
        limit: 5,
        windowMs: 1000,
        algorithm: 'token-bucket' as const,
      };

      clock.set(1_000_000); // enormous idle gap
      const result = await store.consume('key-1', config);
      expect(result.remaining).toBe(4);
    });

    it('isolates buckets by key', async () => {
      const clock = new FakeClock(0);
      const store = new MemoryRateLimitStore(clock);
      const config = {
        limit: 3,
        windowMs: 1000,
        algorithm: 'token-bucket' as const,
      };

      for (let i = 0; i < 3; i++) {
        await store.consume('key-a', config);
      }

      const otherKey = await store.consume('key-b', config);
      expect(otherKey.allowed).toBe(true);
    });
  });
});
