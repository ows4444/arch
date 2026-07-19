export interface AccessTokenDenylist {
  /**
   * Marks `jti` as revoked until `expiresAt` — after that point the access
   * token would have expired naturally anyway, so the entry can be dropped.
   */
  deny(jti: string, expiresAt: Date): Promise<void>;

  isDenied(jti: string): Promise<boolean>;
}
