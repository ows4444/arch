import { CacheStorage } from '../core/cache-storage.interface';

export class MemoryCacheStorage<K, V> implements CacheStorage<K, V> {
  private readonly storage = new Map<K, V>();

  async get(key: K): Promise<V | undefined> {
    return this.storage.get(key);
  }

  async set(key: K, value: V): Promise<void> {
    this.storage.set(key, value);
  }

  async delete(key: K): Promise<boolean> {
    return this.storage.delete(key);
  }

  async has(key: K): Promise<boolean> {
    return this.storage.has(key);
  }

  async clear(): Promise<void> {
    this.storage.clear();
  }

  async size(): Promise<number> {
    return this.storage.size;
  }

  async keys(): Promise<readonly K[]> {
    return [...this.storage.keys()];
  }

  async values(): Promise<readonly V[]> {
    return [...this.storage.values()];
  }

  async entries(): Promise<readonly (readonly [K, V])[]> {
    return [...this.storage.entries()];
  }
}
