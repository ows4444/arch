import { OutboxDispatcherService } from './outbox-dispatcher.service';
import { QueueOutboxEntity } from '../persistence/entities/queue-outbox.entity';

function row(overrides: Partial<QueueOutboxEntity> = {}): QueueOutboxEntity {
  return {
    id: 1,
    messageId: 'm-1',
    exchange: 'ex',
    routingKey: 'rk',
    payload: { a: 1 },
    headers: null,
    status: 'publishing',
    attempts: 0,
    lastError: null,
    claimedBy: 'owner-1',
    claimedAt: new Date(),
    nextAttemptAt: null,
    createdAt: new Date(),
    publishedAt: null,
    ...overrides,
  };
}

function setup(
  options: {
    maxAttempts?: number;
    onExhausted?: (row: QueueOutboxEntity) => void | Promise<void>;
  } = {},
) {
  const outbox = {
    claimBatch: jest.fn(),
    update: jest.fn().mockResolvedValue(undefined),
  };
  const publisher = { publish: jest.fn() };
  const scheduler = { addInterval: jest.fn(), deleteInterval: jest.fn() };

  const service = new OutboxDispatcherService(
    outbox as never,
    publisher as never,
    scheduler as never,
    { maxAttempts: options.maxAttempts, onExhausted: options.onExhausted },
  );

  return { service, outbox, publisher, scheduler };
}

describe('OutboxDispatcherService.sweep', () => {
  it('publishes each claimed row and marks it published on success', async () => {
    const { service, outbox, publisher } = setup();
    outbox.claimBatch.mockResolvedValue([row()]);
    publisher.publish.mockResolvedValue(undefined);

    await service.sweep();

    expect(publisher.publish).toHaveBeenCalledWith(
      { EXCHANGE_NAME: 'ex', ROUTING_KEY: 'rk' },
      { a: 1 },
      expect.objectContaining({ messageId: 'm-1' }),
    );
    expect(outbox.update).toHaveBeenCalledWith(
      { id: 1 },
      expect.objectContaining({ status: 'published', claimedBy: null }),
    );
  });

  it('schedules a retry with backoff when publish fails and attempts remain', async () => {
    const { service, outbox, publisher } = setup({ maxAttempts: 5 });
    outbox.claimBatch.mockResolvedValue([row({ attempts: 1 })]);
    publisher.publish.mockRejectedValue(new Error('broker unavailable'));

    await service.sweep();

    expect(outbox.update).toHaveBeenCalledWith(
      { id: 1 },
      expect.objectContaining({
        status: 'pending',
        attempts: 2,
        claimedBy: null,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        nextAttemptAt: expect.any(Date),
      }),
    );
  });

  it('marks the row permanently failed once maxAttempts is reached', async () => {
    const { service, outbox, publisher } = setup({ maxAttempts: 3 });
    outbox.claimBatch.mockResolvedValue([row({ attempts: 2 })]);
    publisher.publish.mockRejectedValue(new Error('broker unavailable'));

    await service.sweep();

    expect(outbox.update).toHaveBeenCalledWith(
      { id: 1 },
      expect.objectContaining({
        status: 'failed',
        attempts: 3,
        nextAttemptAt: null,
      }),
    );
  });

  it('calls onExhausted when a row is permanently marked failed', async () => {
    const onExhausted = jest.fn().mockResolvedValue(undefined);
    const { service, outbox, publisher } = setup({
      maxAttempts: 1,
      onExhausted,
    });
    outbox.claimBatch.mockResolvedValue([row({ attempts: 0 })]);
    publisher.publish.mockRejectedValue(new Error('broker unavailable'));

    await service.sweep();

    expect(onExhausted).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, status: 'failed', attempts: 1 }),
    );
  });

  it('does not call onExhausted for a retry that still has attempts left', async () => {
    const onExhausted = jest.fn();
    const { service, outbox, publisher } = setup({
      maxAttempts: 5,
      onExhausted,
    });
    outbox.claimBatch.mockResolvedValue([row({ attempts: 0 })]);
    publisher.publish.mockRejectedValue(new Error('broker unavailable'));

    await service.sweep();

    expect(onExhausted).not.toHaveBeenCalled();
  });

  it('logs but does not throw when onExhausted itself fails', async () => {
    const onExhausted = jest.fn().mockRejectedValue(new Error('hook broke'));
    const { service, outbox, publisher } = setup({
      maxAttempts: 1,
      onExhausted,
    });
    outbox.claimBatch.mockResolvedValue([row({ attempts: 0 })]);
    publisher.publish.mockRejectedValue(new Error('broker unavailable'));

    await expect(service.sweep()).resolves.toBeUndefined();
    expect(onExhausted).toHaveBeenCalledTimes(1);
  });

  it('continues dispatching remaining rows when one publish fails', async () => {
    const { service, outbox, publisher } = setup();
    outbox.claimBatch.mockResolvedValue([
      row({ id: 1, messageId: 'm-1' }),
      row({ id: 2, messageId: 'm-2' }),
    ]);
    publisher.publish
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);

    await service.sweep();

    expect(publisher.publish).toHaveBeenCalledTimes(2);
    expect(outbox.update).toHaveBeenCalledWith(
      { id: 1 },
      expect.objectContaining({ status: 'pending' }),
    );
    expect(outbox.update).toHaveBeenCalledWith(
      { id: 2 },
      expect.objectContaining({ status: 'published' }),
    );
  });
});
