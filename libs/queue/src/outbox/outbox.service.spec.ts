import { OutboxService } from './outbox.service';
import { QueueConfigurationError } from '../errors/queue-configuration.error';

describe('OutboxService', () => {
  function setup(outboxOptions: object | undefined) {
    const outbox = { insert: jest.fn().mockResolvedValue(undefined) };
    const service = new OutboxService(outbox as never, outboxOptions);

    return { service, outbox };
  }

  it('inserts a pending row and returns a generated messageId when none is supplied', async () => {
    const { service, outbox } = setup({});

    const messageId = await service.enqueue({
      exchange: 'ex',
      routingKey: 'rk',
      payload: { a: 1 },
    });

    expect(messageId).toEqual(expect.any(String));
    expect(outbox.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId,
        exchange: 'ex',
        routingKey: 'rk',
        payload: { a: 1 },
        status: 'pending',
        attempts: 0,
      }),
    );
  });

  it('uses the caller-supplied messageId when provided', async () => {
    const { service, outbox } = setup({});

    const messageId = await service.enqueue({
      exchange: 'ex',
      routingKey: 'rk',
      payload: { a: 1 },
      messageId: 'custom-id',
    });

    expect(messageId).toBe('custom-id');
    expect(outbox.insert).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'custom-id' }),
    );
  });

  it('rejects enqueue when the module was configured without outbox support', async () => {
    const { service, outbox } = setup(undefined);

    await expect(
      service.enqueue({ exchange: 'ex', routingKey: 'rk', payload: { a: 1 } }),
    ).rejects.toThrow(QueueConfigurationError);
    expect(outbox.insert).not.toHaveBeenCalled();
  });
});
