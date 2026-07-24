import { SetMetadata } from '@nestjs/common';
import { RATE_LIMIT_METADATA } from '../ratelimit.constants';

export interface RateLimitMetadata {
  readonly limiterName: string;

  /** Defaults to the request's IP address when omitted. */
  readonly keyBy?: (request: unknown) => string;

  /**
   * When it returns `true`, `RateLimitGuard` bypasses limiting entirely for
   * this request — no quota consumed, no key resolved. Evaluated before
   * `allowlist`/`denylist`. Common use: exempting internal health-check
   * traffic or a trusted service account.
   */
  readonly skip?: (request: unknown) => boolean;

  /**
   * Resolved keys (post-`keyBy`) that always bypass limiting — checked
   * after `skip`, before `denylist`. E.g. a known internal IP or an
   * always-trusted API key.
   */
  readonly allowlist?: readonly string[];

  /**
   * Resolved keys that are always rejected, without ever consuming or
   * checking quota — checked after `allowlist`. Rejects with the same
   * `TooManyRequestsError` shape a normal over-quota rejection uses (from
   * the caller's perspective, "blocked by policy" and "rate limited" are
   * both just a 429); the `Retry-After` is a fixed value (see
   * `RateLimitGuard`), since a policy block has no natural window to reset
   * against.
   */
  readonly denylist?: readonly string[];
}

/**
 * Marks a route as subject to the named limiter's quota. A route with no
 * `@RateLimit()` is always a no-op in `RateLimitGuard`, even when the guard
 * is registered globally (the default) — so adding this decorator is the
 * only thing that actually turns limiting on for a given route.
 */
export const RateLimit = (
  limiterName: string,
  options?: Pick<
    RateLimitMetadata,
    'keyBy' | 'skip' | 'allowlist' | 'denylist'
  >,
): MethodDecorator =>
  SetMetadata(RATE_LIMIT_METADATA, { limiterName, ...options });
