import { CacheRegistry } from './cache-registry';
import { Cache } from './core/cache.interface';

function fakeCache<V>(): Cache<string, V> {
  return {
    get: jest.fn(),
    set: jest.fn(),
    has: jest.fn(),
    delete: jest.fn(),
    clear: jest.fn(),
    size: jest.fn(),
    keys: jest.fn(),
    values: jest.fn(),
    entries: jest.fn(),
  };
}

describe('CacheRegistry', () => {
  it('registers and retrieves a cache by name', () => {
    const registry = new CacheRegistry();
    const cache = fakeCache<string>();

    registry.register('default', cache);

    expect(registry.get('default')).toBe(cache);
  });

  it('throws when getting a name that was never registered', () => {
    const registry = new CacheRegistry();

    expect(() => registry.get('missing')).toThrow("Cache 'missing' not found.");
  });

  it('has() returns true for a registered name and false otherwise', () => {
    const registry = new CacheRegistry();
    registry.register('default', fakeCache());

    expect(registry.has('default')).toBe(true);
    expect(registry.has('missing')).toBe(false);
  });

  it('throws when registering the same name twice', () => {
    const registry = new CacheRegistry();
    registry.register('default', fakeCache());

    expect(() => registry.register('default', fakeCache())).toThrow(
      "Cache 'default' already registered.",
    );
  });

  it('unregister removes an entry so subsequent get() throws and has() is false', () => {
    const registry = new CacheRegistry();
    registry.register('default', fakeCache());

    registry.unregister('default');

    expect(registry.has('default')).toBe(false);
    expect(() => registry.get('default')).toThrow("Cache 'default' not found.");
  });

  it('unregister on a name that was never registered is a no-op', () => {
    const registry = new CacheRegistry();

    expect(() => registry.unregister('missing')).not.toThrow();
  });

  it('names() returns all registered names', () => {
    const registry = new CacheRegistry();
    registry.register('a', fakeCache());
    registry.register('b', fakeCache());

    expect(registry.names().sort()).toEqual(['a', 'b']);
  });

  it('values() returns all registered cache instances', () => {
    const registry = new CacheRegistry();
    const a = fakeCache();
    const b = fakeCache();
    registry.register('a', a);
    registry.register('b', b);

    expect(registry.values()).toEqual(expect.arrayContaining([a, b]));
    expect(registry.values()).toHaveLength(2);
  });

  it('clear() removes everything', () => {
    const registry = new CacheRegistry();
    registry.register('a', fakeCache());
    registry.register('b', fakeCache());

    registry.clear();

    expect(registry.names()).toEqual([]);
    expect(registry.has('a')).toBe(false);
    expect(registry.has('b')).toBe(false);
  });
});
