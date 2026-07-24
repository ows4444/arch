export interface RateLimitResult {
  readonly allowed: boolean;

  readonly limit: number;

  readonly remaining: number;

  readonly resetAt: Date;
}
