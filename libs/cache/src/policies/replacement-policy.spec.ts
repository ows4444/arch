import { ReplacementPolicy } from './replacement-policy.interface';
import { LruPolicy } from './lru.policy';
import { LfuPolicy } from './lfu.policy';
import { FifoPolicy } from './fifo.policy';
import { MruPolicy } from './mru.policy';

describe.each<[string, () => ReplacementPolicy<string>]>([
  ['LruPolicy', () => new LruPolicy<string>()],
  ['LfuPolicy', () => new LfuPolicy<string>()],
  ['FifoPolicy', () => new FifoPolicy<string>()],
  ['MruPolicy', () => new MruPolicy<string>()],
])('%s (shared ReplacementPolicy contract)', (_name, create) => {
  it('evicts nothing when empty', () => {
    expect(create().evict()).toBeUndefined();
  });

  it('no longer offers a key as a victim once it has been deleted', () => {
    const policy = create();
    policy.onSet('a');
    policy.onDelete('a');

    expect(policy.evict()).toBeUndefined();
  });

  it('forgets all keys on clear', () => {
    const policy = create();
    policy.onSet('a');
    policy.onSet('b');
    policy.onClear();

    expect(policy.evict()).toBeUndefined();
  });

  it('does not throw for onGet/onDelete on an untracked key', () => {
    const policy = create();
    expect(() => policy.onGet('missing')).not.toThrow();
    expect(() => policy.onDelete('missing')).not.toThrow();
  });

  it('removes the evicted key from future eviction candidates', () => {
    const policy = create();
    policy.onSet('a');

    const victim = policy.evict();

    expect(victim).toBe('a');
    expect(policy.evict()).toBeUndefined();
  });
});

describe('LruPolicy', () => {
  it('evicts the least recently used key first', () => {
    const policy = new LruPolicy<string>();
    policy.onSet('a');
    policy.onSet('b');
    policy.onSet('c');

    policy.onGet('a');

    expect(policy.evict()).toBe('b');
  });

  it('treats onSet on an existing key as a fresh use', () => {
    const policy = new LruPolicy<string>();
    policy.onSet('a');
    policy.onSet('b');

    policy.onSet('a');

    expect(policy.evict()).toBe('b');
  });
});

describe('MruPolicy', () => {
  it('evicts the most recently used key first', () => {
    const policy = new MruPolicy<string>();
    policy.onSet('a');
    policy.onSet('b');
    policy.onSet('c');

    policy.onGet('a');

    expect(policy.evict()).toBe('a');
  });
});

describe('FifoPolicy', () => {
  it('evicts in insertion order regardless of access', () => {
    const policy = new FifoPolicy<string>();
    policy.onSet('a');
    policy.onSet('b');
    policy.onSet('c');

    policy.onGet('a');

    expect(policy.evict()).toBe('a');
    expect(policy.evict()).toBe('b');
  });
});

describe('LfuPolicy', () => {
  it('evicts the least frequently used key first', () => {
    const policy = new LfuPolicy<string>();
    policy.onSet('a');
    policy.onSet('b');

    policy.onGet('a');
    policy.onGet('a');

    expect(policy.evict()).toBe('b');
  });

  it('breaks frequency ties by insertion order (oldest first)', () => {
    const policy = new LfuPolicy<string>();
    policy.onSet('a');
    policy.onSet('b');

    expect(policy.evict()).toBe('a');
  });
});
