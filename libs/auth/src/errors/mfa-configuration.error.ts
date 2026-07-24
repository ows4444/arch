/** Mirrors libs/ratelimit's RateLimitConfigurationError shape — a misconfiguration, not an HTTP-facing error. */
export class MfaConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = MfaConfigurationError.name;
  }
}
