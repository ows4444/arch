import type {
  PasswordChangedEvent,
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
}
