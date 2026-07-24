import { Injectable } from '@nestjs/common';
import { RetryableMessageError, RMQConsumer } from '@/queue';
import {
  NotificationService,
  NOTIFICATION_EMAIL_TOPOLOGY,
  EmailMessagePayload,
} from '@/notification';

@Injectable()
export class EmailNotificationConsumer {
  constructor(private readonly notifications: NotificationService) {}

  @RMQConsumer(NOTIFICATION_EMAIL_TOPOLOGY.QUEUES.send, {
    payload: EmailMessagePayload,
  })
  async handleSend(payload: EmailMessagePayload): Promise<void> {
    // `NOTIFICATION_EMAIL_TOPOLOGY.QUEUES.send`'s `retry: retry({ strategy: [1, 5, 15] })`
    // only actually retries an error that's `instanceof RetryableMessageError`
    // (see RMQConsumerRuntime.getRetryDecision) — everything else nacks
    // without requeue on the very first failure, straight to the DLQ. The
    // payload itself is already validated (structurally malformed messages
    // throw NonRetryableMessageError before this handler runs at all), so
    // by the time we're here, a thrown error can only be a delivery failure
    // (e.g. a real provider's transient network/rate-limit error, once one
    // is wired — see ARCH.md's Open Questions) — exactly the case the
    // configured retry policy exists for. Reclassifying keeps that policy
    // reachable instead of being dead configuration.
    try {
      await this.notifications.sendEmail(payload);
    } catch (error) {
      throw new RetryableMessageError(
        `Email send failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
