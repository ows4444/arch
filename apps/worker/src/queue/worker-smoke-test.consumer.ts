import { Injectable, Logger } from '@nestjs/common';
import { RMQConsumer, type RMQContext } from '@/queue';
import { WORKER_SMOKE_TEST_TOPOLOGY } from './worker-smoke-test.topology';
import { WorkerSmokeTestPingPayload } from './worker-smoke-test-ping.payload';

/**
 * Consumes the smoke-test message enqueued by `WorkerController.ping` (see
 * apps/worker/LOOP.md, Loop 002) — proves a real `@RMQConsumer` handler in `apps/worker`
 * receives what `apps/server`'s (or this app's own) `OutboxService` publishes.
 */
@Injectable()
export class WorkerSmokeTestConsumer {
  private readonly logger = new Logger(WorkerSmokeTestConsumer.name);

  @RMQConsumer(WORKER_SMOKE_TEST_TOPOLOGY.QUEUES.ping, {
    payload: WorkerSmokeTestPingPayload,
  })
  handlePing(payload: WorkerSmokeTestPingPayload, context: RMQContext): void {
    this.logger.log({
      message: 'Received worker smoke-test ping',
      payload: payload.message,
      requestId: context.requestId,
      correlationId: context.correlationId,
    });
  }
}
