import { RetryableMessageError } from '@/queue';
import { EmailNotificationConsumer } from './email-notification.consumer';

describe('EmailNotificationConsumer', () => {
  it('delegates the payload to NotificationService.sendEmail', async () => {
    const notifications = { sendEmail: jest.fn().mockResolvedValue(undefined) };
    const consumer = new EmailNotificationConsumer(notifications as never);
    const payload = { to: 'a@example.com', subject: 'Hi', text: 'Hello' };

    await consumer.handleSend(payload);

    expect(notifications.sendEmail).toHaveBeenCalledWith(payload);
  });

  it('reclassifies a send failure as RetryableMessageError so the queue retry policy applies', async () => {
    const notifications = {
      sendEmail: jest.fn().mockRejectedValue(new Error('provider timeout')),
    };
    const consumer = new EmailNotificationConsumer(notifications as never);
    const payload = { to: 'a@example.com', subject: 'Hi', text: 'Hello' };

    const rejection = consumer.handleSend(payload);

    await expect(rejection).rejects.toThrow(RetryableMessageError);
    await expect(rejection).rejects.toThrow(/provider timeout/);
  });
});
