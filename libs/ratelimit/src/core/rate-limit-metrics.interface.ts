/**
 * Cross-cutting observability hook, same "DI token with a no-op default"
 * shape as `libs/workflow`'s `WorkflowMetrics` — lets a host wire
 * Prometheus/OpenTelemetry/whatever without this library taking a hard
 * dependency on either.
 */
export interface RateLimitMetrics {
  requestAllowed(limiterName: string): void;

  requestRejected(limiterName: string): void;

  /** Fired on the fail-open path — see `RateLimitModuleOptions.failOpen`. */
  storeFailure(limiterName: string): void;
}
