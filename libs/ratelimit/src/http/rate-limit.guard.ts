import { CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RateLimiterService } from '../application/rate-limiter.service';
import { RATE_LIMIT_METADATA } from '../ratelimit.constants';
import type { RateLimitMetadata } from './rate-limit.decorator';
import { TooManyRequestsError } from '../errors/too-many-requests.error';

interface RateLimitedRequest {
  readonly ip?: string;

  readonly user?: { readonly userId?: string; readonly roles?: string[] };
}

interface RateLimitedResponse {
  setHeader(name: string, value: string | number): void;
}

/**
 * Fixed `Retry-After` for a `denylist` rejection — unlike an over-quota
 * rejection, a policy block has no natural window to compute a real reset
 * time against.
 */
const DENYLIST_RETRY_AFTER_SECONDS = 3600;

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiterService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const metadata = this.reflector.getAllAndOverride<
      RateLimitMetadata | undefined
    >(RATE_LIMIT_METADATA, [context.getHandler(), context.getClass()]);

    if (!metadata) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RateLimitedRequest>();

    if (metadata.skip?.(request)) {
      return true;
    }

    const key = metadata.keyBy
      ? metadata.keyBy(request)
      : this.defaultKey(request);

    if (metadata.allowlist?.includes(key)) {
      return true;
    }

    const response = context.switchToHttp().getResponse<RateLimitedResponse>();

    if (metadata.denylist?.includes(key)) {
      response.setHeader('Retry-After', DENYLIST_RETRY_AFTER_SECONDS);
      throw new TooManyRequestsError(DENYLIST_RETRY_AFTER_SECONDS);
    }

    // Only the first role is used for role-scoped limit resolution — a
    // user with multiple roles picking a limit by, say, the most
    // permissive of them all would need a real policy decision (which
    // role "wins"); taking the first is a deliberate simplification, not
    // that policy, and fine for the common single-role case.
    const role = request.user?.roles?.[0];

    const result = await this.limiter.consume(metadata.limiterName, key, {
      ...(role !== undefined ? { role } : {}),
    });
    const resetSeconds = Math.max(
      0,
      Math.ceil((result.resetAt.getTime() - Date.now()) / 1000),
    );

    // Informal, long-established convention (kept for compatibility with
    // clients/gateways already reading these).
    response.setHeader('X-RateLimit-Limit', result.limit);
    response.setHeader('X-RateLimit-Remaining', result.remaining);
    response.setHeader(
      'X-RateLimit-Reset',
      Math.ceil(result.resetAt.getTime() / 1000),
    );

    // IETF draft "RateLimit Fields for HTTP" (draft-ietf-httpapi-ratelimit-headers)
    // — `RateLimit-Reset` is delta-seconds until reset, not an epoch
    // timestamp, unlike the `X-RateLimit-Reset` header above.
    response.setHeader('RateLimit-Limit', result.limit);
    response.setHeader('RateLimit-Remaining', result.remaining);
    response.setHeader('RateLimit-Reset', resetSeconds);

    if (!result.allowed) {
      const retryAfterSeconds = Math.max(1, resetSeconds);

      response.setHeader('Retry-After', retryAfterSeconds);

      throw new TooManyRequestsError(retryAfterSeconds);
    }

    return true;
  }

  private defaultKey(request: RateLimitedRequest): string {
    return request.user?.userId ?? request.ip ?? 'unknown';
  }
}
