import { WorkflowLeaseService } from './lease.service';
import { WorkflowConcurrencyError } from '../../errors/workflow.errors';

function setup(withOptionalMethods = true) {
  const store: Record<string, jest.Mock> = withOptionalMethods
    ? {
        acquireLease: jest.fn(),
        releaseLease: jest.fn(),
        renewLease: jest.fn(),
      }
    : {};

  const service = new WorkflowLeaseService(store as never);

  return { service, store };
}

describe('WorkflowLeaseService', () => {
  describe('acquire', () => {
    it('returns undefined when the store does not support leasing', async () => {
      const { service } = setup(false);

      await expect(service.acquire('workflow-1')).resolves.toBeUndefined();
    });

    it('throws a concurrency error when the lease could not be acquired', async () => {
      const { service, store } = setup();
      store.acquireLease!.mockResolvedValue(false);

      await expect(service.acquire('workflow-1')).rejects.toThrow(
        WorkflowConcurrencyError,
      );
    });

    it('returns the owner id when the lease is acquired', async () => {
      const { service, store } = setup();
      store.acquireLease!.mockResolvedValue(true);

      const owner = await service.acquire('workflow-1');

      expect(typeof owner).toBe('string');
      expect(owner).toHaveLength(36);
    });

    it('acquires with the same owner id across calls on the same instance', async () => {
      const { service, store } = setup();
      store.acquireLease!.mockResolvedValue(true);

      const first = await service.acquire('workflow-1');
      const second = await service.acquire('workflow-2');

      expect(first).toBe(second);
    });
  });

  describe('release', () => {
    it('is a no-op when the store does not support leasing', async () => {
      const { service } = setup(false);

      await expect(service.release('workflow-1')).resolves.toBeUndefined();
    });

    it('releases the lease using the service owner id', async () => {
      const { service, store } = setup();
      store.acquireLease!.mockResolvedValue(true);
      const owner = await service.acquire('workflow-1');

      await service.release('workflow-1');

      expect(store.releaseLease).toHaveBeenCalledWith('workflow-1', owner);
    });
  });

  describe('renew', () => {
    it('is a no-op when the store does not support leasing', async () => {
      const { service } = setup(false);

      await expect(service.renew('workflow-1')).resolves.toBeUndefined();
    });

    it('throws when the lease renewal is rejected by the store', async () => {
      const { service, store } = setup();
      store.renewLease!.mockResolvedValue(false);

      await expect(service.renew('workflow-1')).rejects.toThrow(
        WorkflowConcurrencyError,
      );
    });

    it('resolves when the renewal succeeds', async () => {
      const { service, store } = setup();
      store.renewLease!.mockResolvedValue(true);

      await expect(service.renew('workflow-1')).resolves.toBeUndefined();
    });
  });

  describe('onApplicationShutdown', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('resolves immediately when no leases are held', async () => {
      const { service } = setup();

      await expect(service.onApplicationShutdown()).resolves.toBeUndefined();
    });

    it('resolves quickly, without waiting the full grace period, once a held lease is released', async () => {
      const { service, store } = setup();
      store.acquireLease!.mockResolvedValue(true);
      store.releaseLease!.mockResolvedValue(undefined);
      await service.acquire('workflow-1');

      const shutdown = service.onApplicationShutdown();

      await jest.advanceTimersByTimeAsync(100);
      await service.release('workflow-1');
      await jest.advanceTimersByTimeAsync(100);

      await expect(shutdown).resolves.toBeUndefined();
      expect(store.releaseLease).toHaveBeenCalledTimes(1);
    });

    it('force-releases leases still held after the grace period elapses', async () => {
      const { service, store } = setup();
      store.acquireLease!.mockResolvedValue(true);
      store.releaseLease!.mockResolvedValue(undefined);
      await service.acquire('workflow-1');
      await service.acquire('workflow-2');

      const shutdown = service.onApplicationShutdown();

      await jest.advanceTimersByTimeAsync(5_000);

      await shutdown;

      expect(store.releaseLease).toHaveBeenCalledWith(
        'workflow-1',
        expect.any(String),
      );
      expect(store.releaseLease).toHaveBeenCalledWith(
        'workflow-2',
        expect.any(String),
      );
      expect(store.releaseLease).toHaveBeenCalledTimes(2);
    });
  });

  describe('keepAlive', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('periodically renews the lease until stopped', async () => {
      const { service, store } = setup();
      store.renewLease!.mockResolvedValue(true);

      const stop = service.keepAlive('workflow-1', 2_000);

      await jest.advanceTimersByTimeAsync(1_000);
      expect(store.renewLease).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(1_000);
      expect(store.renewLease).toHaveBeenCalledTimes(2);

      stop();

      await jest.advanceTimersByTimeAsync(2_000);
      expect(store.renewLease).toHaveBeenCalledTimes(2);
    });

    it('stops renewing once the lease is lost', async () => {
      const { service, store } = setup();
      store.renewLease!.mockResolvedValue(false);

      service.keepAlive('workflow-1', 2_000);

      await jest.advanceTimersByTimeAsync(1_000);
      await jest.advanceTimersByTimeAsync(1_000);
      await jest.advanceTimersByTimeAsync(1_000);

      expect(store.renewLease).toHaveBeenCalledTimes(1);
    });
  });
});
