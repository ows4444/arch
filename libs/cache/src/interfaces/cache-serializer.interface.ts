export interface CacheSerializer {
  serialize<T>(value: T): string;

  deserialize<T>(value: string): T | undefined;
}
