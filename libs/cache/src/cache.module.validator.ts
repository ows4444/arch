import {
  CacheConfiguration,
  CacheModuleOptions,
} from './interfaces/cache.interfaces';

export class CacheModuleValidator {
  static validate(options: CacheModuleOptions): void {
    if (Object.keys(options.caches).length === 0) {
      throw new Error('At least one cache must be configured.');
    }

    if (
      options.defaultCache !== undefined &&
      !(options.defaultCache in options.caches)
    ) {
      throw new Error(
        `Default cache '${options.defaultCache}' is not configured.`,
      );
    }

    for (const [name, config] of Object.entries(options.caches)) {
      if (config.type !== 'multi-level') {
        continue;
      }

      this.validateMultiLevel(name, config, options);
    }

    this.validateCycles(options);
    this.validateRedisNamespaces(options);
  }

  /**
   * Two `redis` caches that share both a Redis client and an (effective,
   * default-applied) namespace would silently share the same Redis
   * keyspace — `RedisCacheStore` keys are just `${namespace}:${key}`, with
   * no isolation beyond that string prefix. A `clear()`/`keys()`/`entries()`
   * SCAN on one cache would then enumerate and (for `clear()`) `UNLINK` the
   * other cache's entries too. Since `namespace` defaults to `'cache'` when
   * omitted, this is easy to hit by accident (e.g. two `redis` cache
   * entries reusing the same client and both omitting `namespace`) — catch
   * it at boot rather than letting it corrupt data at runtime.
   */
  private static validateRedisNamespaces(options: CacheModuleOptions): void {
    const namespacesByClient = new Map<unknown, Map<string, string>>();

    for (const [name, config] of Object.entries(options.caches)) {
      if (config.type !== 'redis') {
        continue;
      }

      const namespace = config.options.namespace ?? 'cache';

      let namespaces = namespacesByClient.get(config.options.client);

      if (!namespaces) {
        namespaces = new Map<string, string>();
        namespacesByClient.set(config.options.client, namespaces);
      }

      const collidingCache = namespaces.get(namespace);

      if (collidingCache) {
        throw new Error(
          `Caches '${collidingCache}' and '${name}' share both a Redis client and namespace '${namespace}' — their keyspaces would collide. Configure a distinct 'namespace' for each.`,
        );
      }

      namespaces.set(namespace, name);
    }
  }

  private static validateMultiLevel(
    name: string,
    config: Extract<CacheConfiguration, { type: 'multi-level' }>,
    options: CacheModuleOptions,
  ): void {
    const { l1, l2 } = config.options;

    if (!(l1 in options.caches)) {
      throw new Error(`Cache '${name}' references unknown cache '${l1}'.`);
    }

    if (!(l2 in options.caches)) {
      throw new Error(`Cache '${name}' references unknown cache '${l2}'.`);
    }

    if (l1 === name || l2 === name) {
      throw new Error(`Cache '${name}' cannot reference itself.`);
    }
  }

  private static validateCycles(options: CacheModuleOptions): void {
    const visited = new Set<string>();
    const active = new Set<string>();

    for (const name of Object.keys(options.caches)) {
      this.visit(name, options, visited, active);
    }
  }

  private static visit(
    name: string,
    options: CacheModuleOptions,
    visited: Set<string>,
    active: Set<string>,
  ): void {
    if (visited.has(name)) {
      return;
    }

    if (active.has(name)) {
      throw new Error(
        `Circular cache dependency detected involving '${name}'.`,
      );
    }

    active.add(name);

    const config = options.caches[name];

    if (!config) {
      throw new Error(`Cache '${name}' is not configured.`);
    }

    if (config.type === 'multi-level') {
      this.visit(config.options.l1, options, visited, active);
      this.visit(config.options.l2, options, visited, active);
    }

    active.delete(name);
    visited.add(name);
  }
}
