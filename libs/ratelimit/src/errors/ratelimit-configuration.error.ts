/** Mirrors libs/queue's QueueConfigurationError shape — a boot-time misconfiguration, not an HTTP-facing error. */
export class RateLimitConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = RateLimitConfigurationError.name;
  }
}
