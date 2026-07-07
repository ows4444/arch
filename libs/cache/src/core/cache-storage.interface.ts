export interface CacheStorage<K, V> {
  get(key: K): Promise<V | undefined>;

  set(key: K, value: V): Promise<void>;

  delete(key: K): Promise<boolean>;

  clear(): Promise<void>;

  has(key: K): Promise<boolean>;

  size(): Promise<number>;

  keys(): Promise<readonly K[]>;

  values(): Promise<readonly V[]>;

  entries(): Promise<readonly (readonly [K, V])[]>;
}
