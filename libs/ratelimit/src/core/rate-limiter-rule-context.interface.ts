export interface RateLimiterRuleContext {
  /**
   * When present, the resolver first tries `"${limiterName}:role:${role}"`
   * (a role-scoped override) before falling back to the plain
   * `limiterName` — e.g. an `admin` role configured with a higher limit
   * than the general population under the same named limiter.
   */
  readonly role?: string;
}
