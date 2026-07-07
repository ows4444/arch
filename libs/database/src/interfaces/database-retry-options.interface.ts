export interface DatabaseRetryOptions {
  readonly maxAttempts?: number;

  readonly initialDelayMs?: number;

  readonly maxDelayMs?: number;

  readonly reconnectCooldownMs?: number;
}
