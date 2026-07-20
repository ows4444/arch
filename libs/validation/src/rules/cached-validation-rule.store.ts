import type { CacheManager } from '@/cache';
import type { StoredRule } from './stored-rule.interface';
import type { ValidationRuleStore } from './validation-rule-store.interface';

export interface CachedValidationRuleStoreOptions {
  readonly cacheName?: string;
  readonly ttlMs?: number;
}

const DEFAULT_CACHE_NAME = 'default';
const DEFAULT_TTL_MS = 30_000;

/**
 * Wraps another `ValidationRuleStore` with a short-TTL cache, so `validateStored` doesn't hit
 * the database on every call. Type-only dependency on `@/cache` (`CacheManager`) — never `@/cache`'s
 * tokens or module — following the same precedent `libs/auth`'s `CacheAccessTokenDenylist`
 * established: the consuming app constructs this instance and injects the actual `CacheManager`,
 * `libs/validation` never registers or depends on `CacheModule` itself. See ARCH.md, Design 003.
 */
export class CachedValidationRuleStore implements ValidationRuleStore {
  private readonly cacheName: string;
  private readonly ttlMs: number;

  constructor(
    private readonly inner: ValidationRuleStore,
    private readonly cacheManager: CacheManager,
    options: CachedValidationRuleStoreOptions = {},
  ) {
    this.cacheName = options.cacheName ?? DEFAULT_CACHE_NAME;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  }

  findRules(targetType: string): Promise<StoredRule[]> {
    return this.cacheManager.getOrLoad<StoredRule[]>(
      this.cacheName,
      this.key(targetType),
      () => this.inner.findRules(targetType),
      { ttl: this.ttlMs },
    );
  }

  invalidate(targetType: string): Promise<void> {
    return this.cacheManager.delete(this.cacheName, this.key(targetType));
  }

  private key(targetType: string): string {
    return `validation-rules:${targetType}`;
  }
}
