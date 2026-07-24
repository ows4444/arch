import { Injectable } from '@nestjs/common';
import { OutboxService } from '@/queue';
import {
  NOTIFICATION_EMAIL_TOPOLOGY,
  type EmailMessagePayload,
} from '@/notification';
import type {
  AuthEventPublisher,
  EmailVerificationRequestedEvent,
  PasswordResetRequestedEvent,
} from '@/auth';

/**
 * The first real `AuthEventPublisher` this monorepo has ever wired — every
 * prior loop used `NoopAuthEventPublisher`. Only the two events that carry
 * a raw token with nowhere else to go (`publishPasswordResetRequested`/
 * `publishEmailVerificationRequested`) actually publish; the other four
 * stay no-op, matching today's behavior exactly — see
 * `libs/notification/ARCH.md`, Open Questions (wiring a "welcome
 * email"/security alert for the other four events is explicitly out of
 * this design's scope until a concrete requirement appears).
 *
 * Composing the actual subject/body wording lives here, not inside
 * `libs/notification` — that library only knows how to send an already-
 * composed `{ to, subject, text }`, not why (see ARCH.md, Context Map).
 */
@Injectable()
export class QueueAuthEventPublisher implements AuthEventPublisher {
  constructor(private readonly outbox: OutboxService) {}

  async publishPasswordResetRequested(
    event: PasswordResetRequestedEvent,
  ): Promise<void> {
    await this.enqueueEmail({
      to: event.email,
      subject: 'Reset your password',
      text: `Use this code to reset your password: ${event.token}\n\nThis code expires at ${event.expiresAt.toISOString()}. If you didn't request this, you can ignore this email.`,
    });
  }

  async publishEmailVerificationRequested(
    event: EmailVerificationRequestedEvent,
  ): Promise<void> {
    await this.enqueueEmail({
      to: event.email,
      subject: 'Verify your email address',
      text: `Use this code to verify your email address: ${event.token}\n\nThis code expires at ${event.expiresAt.toISOString()}.`,
    });
  }

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

  private async enqueueEmail(
    payload: Omit<EmailMessagePayload, 'html'>,
  ): Promise<void> {
    await this.outbox.enqueue({
      exchange: NOTIFICATION_EMAIL_TOPOLOGY.EXCHANGE_NAME,
      routingKey: NOTIFICATION_EMAIL_TOPOLOGY.QUEUES.send.ROUTING_KEY,
      payload,
    });
  }
}
