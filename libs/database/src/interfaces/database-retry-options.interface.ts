export interface DatabaseRetryOptions {
  readonly maxAttempts?: number;

  readonly initialDelayMs?: number;

  readonly maxDelayMs?: number;

  readonly reconnectCooldownMs?: number;

  /** How long a stalled read waits for its datasource to recover before failing fast. */
  readonly readRecoveryTimeoutMs?: number;
}
