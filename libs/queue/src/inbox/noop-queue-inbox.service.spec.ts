import { NoopQueueInboxService } from './noop-queue-inbox.service';

describe('NoopQueueInboxService', () => {
  it('runs the operation unconditionally and reports it as having run', async () => {
    const service = new NoopQueueInboxService();
    const operation = jest.fn().mockResolvedValue(undefined);

    const ran = await service.withIdempotency('queue', 'msg-1', operation);

    expect(ran).toBe(true);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('runs the operation again for the exact same key (no dedup)', async () => {
    const service = new NoopQueueInboxService();
    const operation = jest.fn().mockResolvedValue(undefined);

    await service.withIdempotency('queue', 'msg-1', operation);
    await service.withIdempotency('queue', 'msg-1', operation);

    expect(operation).toHaveBeenCalledTimes(2);
  });
});
