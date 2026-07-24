import { NoopEmailSender } from './noop-email-sender';

describe('NoopEmailSender', () => {
  it('resolves without doing anything observable', async () => {
    const sender = new NoopEmailSender();

    await expect(
      sender.send({ to: 'a@example.com', subject: 'Hi', text: 'Hello' }),
    ).resolves.toBeUndefined();
  });
});
