import { Injectable } from '@nestjs/common';
import type { AuthEventPublisher } from '../ports/auth-event-publisher.interface';

@Injectable()
export class NoopAuthEventPublisher implements AuthEventPublisher {
  publishUserRegistered(): Promise<void> {
    return Promise.resolve();
  }

  publishUserLoggedIn(): Promise<void> {
    return Promise.resolve();
  }

  publishPasswordChanged(): Promise<void> {
    return Promise.resolve();
  }

  publishRefreshTokenReuseDetected(): Promise<void> {
    return Promise.resolve();
  }

  publishPasswordResetRequested(): Promise<void> {
    return Promise.resolve();
  }

  publishEmailVerificationRequested(): Promise<void> {
    return Promise.resolve();
  }
}
