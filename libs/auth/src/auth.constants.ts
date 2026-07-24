export const AUTH_MODULE_OPTIONS = Symbol('AUTH_MODULE_OPTIONS');

export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');

export const ACCESS_TOKEN_DENYLIST = Symbol('ACCESS_TOKEN_DENYLIST');

export const AUTH_EVENT_PUBLISHER = Symbol('AUTH_EVENT_PUBLISHER');

export const MFA_SECRET_CIPHER = Symbol('MFA_SECRET_CIPHER');

export const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

export const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export const DEFAULT_PASSWORD_RESET_TOKEN_TTL_SECONDS = 60 * 60;

export const DEFAULT_EMAIL_VERIFICATION_TOKEN_TTL_SECONDS = 24 * 60 * 60;

/** How long a post-password, pre-TOTP MFA challenge token stays valid. */
export const DEFAULT_MFA_CHALLENGE_TTL_SECONDS = 5 * 60;

/** How many single-use backup codes `MfaService.confirmEnrollment` issues. */
export const DEFAULT_MFA_RECOVERY_CODES_COUNT = 10;

export const DEFAULT_MAX_ACTIVE_SESSIONS_PER_USER = 5;

/**
 * Grace window `RefreshTokenService.purgeExpiredTokens` waits past
 * revocation/expiry before deleting a row — keeps `rotate()`'s reuse
 * detection able to observe a just-revoked row for a while after the fact.
 */
export const DEFAULT_REFRESH_TOKEN_PURGE_GRACE_SECONDS = 24 * 60 * 60;
