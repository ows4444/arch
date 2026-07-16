import { CacheSerializer } from '../interfaces/cache-serializer.interface';

export class JsonCacheSerializer implements CacheSerializer {
  serialize<T>(value: T): string {
    return JSON.stringify(value) ?? 'null';
  }

  deserialize<T>(value: string): T | undefined {
    try {
      return JSON.parse(value) as T;
    } catch {
      return undefined;
    }
  }
}

export class SafeJsonCacheSerializer implements CacheSerializer {
  /** See {@link JsonCacheSerializer.serialize} for the `undefined` round-trip note. */
  serialize<T>(value: T): string {
    try {
      return JSON.stringify(value) ?? 'null';
    } catch (error) {
      throw new Error(
        `Failed to serialize cache value: ${(error as Error).message}`,
      );
    }
  }

  deserialize<T>(value: string): T | undefined {
    try {
      return JSON.parse(value) as T;
    } catch {
      return undefined;
    }
  }
}
