import { EmailNotificationConsumer } from './email-notification.consumer';

describe('EmailNotificationConsumer', () => {
  it('delegates the payload to NotificationService.sendEmail', async () => {
    const notifications = { sendEmail: jest.fn().mockResolvedValue(undefined) };
    const consumer = new EmailNotificationConsumer(notifications as never);
    const payload = { to: 'a@example.com', subject: 'Hi', text: 'Hello' };

    await consumer.handleSend(payload);

    expect(notifications.sendEmail).toHaveBeenCalledWith(payload);
  });
});
