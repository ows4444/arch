import type { CacheManager } from '@/cache';
import { CachedValidationRuleStore } from './cached-validation-rule.store';
import { ValidationRuleOperator } from './validation-rule-operator.enum';
import type { StoredRule } from './stored-rule.interface';
import type { ValidationRuleStore } from './validation-rule-store.interface';

function fakeCacheManager(): CacheManager {
  const store = new Map<string, unknown>();

  return {
    get: (cache, key) => Promise.resolve(store.get(`${cache}:${key}`) as never),
    getOrLoad: async (cache, key, loader) => {
      const cacheKey = `${cache}:${key}`;

      if (store.has(cacheKey)) {
        return store.get(cacheKey) as never;
      }

      const value = await loader();
      store.set(cacheKey, value);

      return value;
    },
    set: (cache, key, value) => {
      store.set(`${cache}:${key}`, value);

      return Promise.resolve();
    },
    delete: (cache, key) => {
      store.delete(`${cache}:${key}`);

      return Promise.resolve();
    },
    clear: () => {
      store.clear();

      return Promise.resolve();
    },
    statistics: () => Promise.resolve(undefined),
    resetStatistics: () => Promise.resolve(false),
  };
}

function rule(id: number): StoredRule {
  return {
    id,
    targetType: 'Role',
    field: 'name',
    operator: ValidationRuleOperator.NOT_EQUALS,
    value: 'root',
    compareField: null,
    message: null,
  };
}

function fakeInnerStore(
  impl: (targetType: string) => Promise<StoredRule[]>,
): ValidationRuleStore {
  return {
    findRules: jest.fn(impl),
    invalidate: jest.fn(() => Promise.resolve()),
  };
}

describe('CachedValidationRuleStore', () => {
  it('caches the inner store result, calling it only once per target type', async () => {
    const inner = fakeInnerStore(() => Promise.resolve([rule(1)]));
    const store = new CachedValidationRuleStore(inner, fakeCacheManager());

    const first = await store.findRules('Role');
    const second = await store.findRules('Role');

    expect(first).toEqual([rule(1)]);
    expect(second).toEqual([rule(1)]);
    expect(inner.findRules).toHaveBeenCalledTimes(1);
  });

  it('caches different target types independently', async () => {
    const inner = fakeInnerStore((targetType) =>
      Promise.resolve(targetType === 'Role' ? [rule(1)] : [rule(2)]),
    );
    const store = new CachedValidationRuleStore(inner, fakeCacheManager());

    await store.findRules('Role');
    await store.findRules('Order');

    expect(inner.findRules).toHaveBeenCalledTimes(2);
    expect(inner.findRules).toHaveBeenNthCalledWith(1, 'Role');
    expect(inner.findRules).toHaveBeenNthCalledWith(2, 'Order');
  });

  it('invalidate busts the cached entry, forcing the next findRules to hit the inner store again', async () => {
    const inner = fakeInnerStore(() => Promise.resolve([rule(1)]));
    const store = new CachedValidationRuleStore(inner, fakeCacheManager());

    await store.findRules('Role');
    await store.invalidate('Role');
    await store.findRules('Role');

    expect(inner.findRules).toHaveBeenCalledTimes(2);
  });

  it('invalidate only affects the given target type', async () => {
    const inner = fakeInnerStore((targetType) =>
      Promise.resolve(targetType === 'Role' ? [rule(1)] : [rule(2)]),
    );
    const store = new CachedValidationRuleStore(inner, fakeCacheManager());

    await store.findRules('Role');
    await store.findRules('Order');
    await store.invalidate('Role');
    await store.findRules('Role');
    await store.findRules('Order');

    expect(inner.findRules).toHaveBeenCalledTimes(3);
  });
});
