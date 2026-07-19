import { Injectable } from '@nestjs/common';
import type { AccessTokenDenylist } from '../ports/access-token-denylist.interface';

/**
 * Default `ACCESS_TOKEN_DENYLIST`: logout still revokes the refresh token
 * immediately, but an already-issued access token remains valid until its
 * own short natural expiry. Wire `CacheAccessTokenDenylist` instead for
 * instant revocation (see libs/auth/ARCH.md, Key Decisions MEDIUM #3).
 */
@Injectable()
export class NoopAccessTokenDenylist implements AccessTokenDenylist {
  deny(): Promise<void> {
    return Promise.resolve();
  }

  isDenied(): Promise<boolean> {
    return Promise.resolve(false);
  }
}
