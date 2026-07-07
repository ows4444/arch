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

    if (config.type === 'multi-level') {
      this.visit(config.options.l1, options, visited, active);
      this.visit(config.options.l2, options, visited, active);
    }

    active.delete(name);
    visited.add(name);
  }
}
