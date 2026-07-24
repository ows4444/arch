import type {
  EmailVerificationRequestedEvent,
  PasswordChangedEvent,
  PasswordResetRequestedEvent,
  RefreshTokenReuseDetectedEvent,
  UserLoggedInEvent,
  UserRegisteredEvent,
} from './auth.events';

export interface AuthEventPublisher {
  publishUserRegistered(event: UserRegisteredEvent): Promise<void>;

  publishUserLoggedIn(event: UserLoggedInEvent): Promise<void>;

  publishPasswordChanged(event: PasswordChangedEvent): Promise<void>;

  publishRefreshTokenReuseDetected(
    event: RefreshTokenReuseDetectedEvent,
  ): Promise<void>;

  publishPasswordResetRequested(
    event: PasswordResetRequestedEvent,
  ): Promise<void>;

  publishEmailVerificationRequested(
    event: EmailVerificationRequestedEvent,
  ): Promise<void>;
}
