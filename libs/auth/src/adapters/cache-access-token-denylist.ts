import type { CacheManager } from '@/cache';
import type { AccessTokenDenylist } from '../ports/access-token-denylist.interface';

/**
 * Optional `ACCESS_TOKEN_DENYLIST` backed by `@/cache`, for hosts that want
 * immediate access-token revocation on logout/password change instead of
 * relying on the access token's own short natural expiry. Not registered by
 * `AuthModule` automatically — construct and pass it via
 * `AuthModule.forRoot({ accessTokenDenylist: new CacheAccessTokenDenylist(...) })`,
 * the same way `apps/server` manually constructs `IoRedisClientAdapter`.
 */
export class CacheAccessTokenDenylist implements AccessTokenDenylist {
  constructor(
    private readonly cacheManager: CacheManager,
    private readonly cacheName = 'default',
  ) {}

  async deny(jti: string, expiresAt: Date): Promise<void> {
    const ttlMs = expiresAt.getTime() - Date.now();

    if (ttlMs <= 0) {
      return;
    }

    await this.cacheManager.set(this.cacheName, this.key(jti), true, ttlMs);
  }

  async isDenied(jti: string): Promise<boolean> {
    const value = await this.cacheManager.get<boolean>(
      this.cacheName,
      this.key(jti),
    );

    return value === true;
  }

  private key(jti: string): string {
    return `auth:denylist:${jti}`;
  }
}
