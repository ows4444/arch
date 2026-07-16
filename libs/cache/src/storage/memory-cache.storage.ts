import { CacheStorage } from '../core/cache-storage.interface';

export class MemoryCacheStorage<K, V> implements CacheStorage<K, V> {
  private readonly storage = new Map<K, V>();

  get(key: K): Promise<V | undefined> {
    return Promise.resolve(this.storage.get(key));
  }

  set(key: K, value: V): Promise<void> {
    this.storage.set(key, value);
    return Promise.resolve();
  }

  delete(key: K): Promise<boolean> {
    return Promise.resolve(this.storage.delete(key));
  }

  has(key: K): Promise<boolean> {
    return Promise.resolve(this.storage.has(key));
  }

  clear(): Promise<void> {
    this.storage.clear();
    return Promise.resolve();
  }

  size(): Promise<number> {
    return Promise.resolve(this.storage.size);
  }

  keys(): Promise<readonly K[]> {
    return Promise.resolve([...this.storage.keys()]);
  }

  values(): Promise<readonly V[]> {
    return Promise.resolve([...this.storage.values()]);
  }

  entries(): Promise<readonly (readonly [K, V])[]> {
    return Promise.resolve([...this.storage.entries()]);
  }
}
