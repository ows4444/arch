export interface CacheGetOptions {
  touch?: boolean;
}

export interface CacheSetOptions {
  ttl?: number;
}

export type CacheDeleteOptions = object;

export interface Cache<K, V> {
  get(key: K, options?: CacheGetOptions): Promise<V | undefined>;

  set(key: K, value: V, options?: CacheSetOptions): Promise<void>;

  has(key: K): Promise<boolean>;

  delete(key: K, options?: CacheDeleteOptions): Promise<boolean>;

  clear(): Promise<void>;

  size(): Promise<number>;

  keys(): Promise<readonly K[]>;

  values(): Promise<readonly V[]>;

  entries(): Promise<readonly (readonly [K, V])[]>;
}
