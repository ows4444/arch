import { Logger } from '@nestjs/common';
import { LoggingEmailSender } from './logging-email-sender';

describe('LoggingEmailSender', () => {
  it('logs the message and resolves', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const sender = new LoggingEmailSender();
    const message = { to: 'a@example.com', subject: 'Hi', text: 'Hello' };

    await expect(sender.send(message)).resolves.toBeUndefined();

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'a@example.com',
        subject: 'Hi',
        text: 'Hello',
      }),
    );

    logSpy.mockRestore();
  });

  it('includes html in the log only when provided', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const sender = new LoggingEmailSender();

    await sender.send({
      to: 'a@example.com',
      subject: 'Hi',
      text: 'Hello',
      html: '<p>Hello</p>',
    });

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ html: '<p>Hello</p>' }),
    );

    logSpy.mockRestore();
  });
});
