import { QueueAuthEventPublisher } from './queue-auth-event-publisher';
import { NOTIFICATION_EMAIL_TOPOLOGY } from '@/notification';

interface EnqueuedMessage {
  exchange: string;
  routingKey: string;
  payload: { to: string; subject: string; text: string };
}

describe('QueueAuthEventPublisher', () => {
  function setup() {
    const outbox = {
      enqueue: jest
        .fn<Promise<string>, [EnqueuedMessage]>()
        .mockResolvedValue('message-id'),
    };
    const publisher = new QueueAuthEventPublisher(outbox as never);

    return { publisher, outbox };
  }

  it('enqueues a password-reset email via the shared notification topology', async () => {
    const { publisher, outbox } = setup();
    const expiresAt = new Date('2026-08-01T00:00:00.000Z');

    await publisher.publishPasswordResetRequested({
      userId: 'user-1',
      email: 'a@example.com',
      token: 'raw-token',
      expiresAt,
    });

    expect(outbox.enqueue).toHaveBeenCalledTimes(1);

    const call = outbox.enqueue.mock.calls[0]?.[0];

    if (!call) {
      throw new Error('expected enqueue to have been called');
    }

    expect(call.exchange).toBe(NOTIFICATION_EMAIL_TOPOLOGY.EXCHANGE_NAME);
    expect(call.routingKey).toBe(
      NOTIFICATION_EMAIL_TOPOLOGY.QUEUES.send.ROUTING_KEY,
    );
    expect(call.payload.to).toBe('a@example.com');
    expect(call.payload.subject).toBe('Reset your password');
    expect(call.payload.text).toContain('raw-token');
  });

  it('enqueues an email-verification email via the shared notification topology', async () => {
    const { publisher, outbox } = setup();
    const expiresAt = new Date('2026-08-01T00:00:00.000Z');

    await publisher.publishEmailVerificationRequested({
      userId: 'user-1',
      email: 'a@example.com',
      token: 'verify-token',
      expiresAt,
    });

    expect(outbox.enqueue).toHaveBeenCalledTimes(1);

    const call = outbox.enqueue.mock.calls[0]?.[0];

    if (!call) {
      throw new Error('expected enqueue to have been called');
    }

    expect(call.exchange).toBe(NOTIFICATION_EMAIL_TOPOLOGY.EXCHANGE_NAME);
    expect(call.routingKey).toBe(
      NOTIFICATION_EMAIL_TOPOLOGY.QUEUES.send.ROUTING_KEY,
    );
    expect(call.payload.to).toBe('a@example.com');
    expect(call.payload.subject).toBe('Verify your email address');
    expect(call.payload.text).toContain('verify-token');
  });

  it('leaves the other four events as no-ops, matching NoopAuthEventPublisher', async () => {
    const { publisher, outbox } = setup();

    await publisher.publishUserRegistered();
    await publisher.publishUserLoggedIn();
    await publisher.publishPasswordChanged();
    await publisher.publishRefreshTokenReuseDetected();

    expect(outbox.enqueue).not.toHaveBeenCalled();
  });
});
