import type { Redis } from 'ioredis';
import type { RedisClient } from '@/cache';

export class IoRedisClientAdapter implements RedisClient {
  constructor(private readonly client: Redis) {}

  get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds === undefined) {
      await this.client.set(key, value);
      return;
    }

    await this.client.set(key, value, 'EX', ttlSeconds);
  }

  del(key: string): Promise<number> {
    return this.client.del(key);
  }

  exists(key: string): Promise<number> {
    return this.client.exists(key);
  }

  pttl(key: string): Promise<number> {
    return this.client.pttl(key);
  }
}
