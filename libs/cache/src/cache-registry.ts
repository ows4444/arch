import { Cache } from './core/cache.interface';

export class CacheRegistry {
  private readonly caches = new Map<string, Cache<string, unknown>>();

  values(): readonly Cache<string, unknown>[] {
    return Array.from(this.caches.values());
  }

  register<T>(name: string, cache: Cache<string, T>): void {
    if (this.caches.has(name)) {
      throw new Error(`Cache '${name}' already registered.`);
    }

    this.caches.set(name, cache);
  }

  get<T>(name: string): Cache<string, T> {
    const cache = this.caches.get(name);

    if (!cache) {
      throw new Error(`Cache '${name}' not found.`);
    }

    return cache as Cache<string, T>;
  }

  has(name: string): boolean {
    return this.caches.has(name);
  }

  unregister(name: string): void {
    this.caches.delete(name);
  }

  clear(): void {
    this.caches.clear();
  }

  names(): string[] {
    return Array.from(this.caches.keys());
  }
}
