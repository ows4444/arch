import { NotificationService } from './notification.service';

describe('NotificationService', () => {
  it('delegates sendEmail to the injected EmailSender', async () => {
    const emailSender = { send: jest.fn().mockResolvedValue(undefined) };
    const service = new NotificationService(emailSender);
    const message = { to: 'a@example.com', subject: 'Hi', text: 'Hello' };

    await service.sendEmail(message);

    expect(emailSender.send).toHaveBeenCalledWith(message);
  });

  it('propagates a send failure rather than swallowing it', async () => {
    const emailSender = {
      send: jest.fn().mockRejectedValue(new Error('smtp down')),
    };
    const service = new NotificationService(emailSender);

    await expect(
      service.sendEmail({ to: 'a@example.com', subject: 'Hi', text: 'Hello' }),
    ).rejects.toThrow('smtp down');
  });
});
