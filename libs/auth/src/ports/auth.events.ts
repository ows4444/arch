export interface UserRegisteredEvent {
  userId: string;

  email: string;
}

export interface UserLoggedInEvent {
  userId: string;

  at: Date;
}

export interface PasswordChangedEvent {
  userId: string;
}

export interface RefreshTokenReuseDetectedEvent {
  userId: string;

  familyId: string;
}

/**
 * Carries the raw (unhashed) token — libs/auth has no email-sending
 * capability of its own (see the `AuthEventPublisher` no-op default
 * pattern); the host app's real publisher is what actually emails this
 * link to the user, using the raw token, before it's ever persisted only
 * as a hash.
 */
export interface PasswordResetRequestedEvent {
  userId: string;

  email: string;

  token: string;

  expiresAt: Date;
}

export interface EmailVerificationRequestedEvent {
  userId: string;

  email: string;

  token: string;

  expiresAt: Date;
}
