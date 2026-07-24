import { Injectable } from '@nestjs/common';
import type { RateLimitMetrics } from '../core/rate-limit-metrics.interface';

@Injectable()
export class NoopRateLimitMetrics implements RateLimitMetrics {
  requestAllowed(): void {}

  requestRejected(): void {}

  storeFailure(): void {}
}
