export const AUTH_MODULE_OPTIONS = Symbol('AUTH_MODULE_OPTIONS');

export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');

export const ACCESS_TOKEN_DENYLIST = Symbol('ACCESS_TOKEN_DENYLIST');

export const AUTH_EVENT_PUBLISHER = Symbol('AUTH_EVENT_PUBLISHER');

export const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

export const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export const DEFAULT_PASSWORD_RESET_TOKEN_TTL_SECONDS = 60 * 60;

export const DEFAULT_EMAIL_VERIFICATION_TOKEN_TTL_SECONDS = 24 * 60 * 60;

export const DEFAULT_MAX_ACTIVE_SESSIONS_PER_USER = 5;

/**
 * Grace window `RefreshTokenService.purgeExpiredTokens` waits past
 * revocation/expiry before deleting a row — keeps `rotate()`'s reuse
 * detection able to observe a just-revoked row for a while after the fact.
 */
export const DEFAULT_REFRESH_TOKEN_PURGE_GRACE_SECONDS = 24 * 60 * 60;
