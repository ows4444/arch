import { Injectable } from '@nestjs/common';
import { RMQConsumer } from '@/queue';
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
    await this.notifications.sendEmail(payload);
  }
}
