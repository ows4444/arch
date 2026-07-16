import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SchedulerRegistry } from '@nestjs/schedule';
import { DatabaseRole, InjectRepository } from '@/database';
import { OutboxRepository } from './outbox.repository';
import type { QueueOutboxOptions } from './outbox.types';
import { QUEUE_OUTBOX_OPTIONS } from '../queue.constants';
import { RMQPublisher } from '../publisher/rmq.publisher';
import { QueueOutboxEntity } from '../persistence/entities/queue-outbox.entity';

const DEFAULT_INTERVAL_MS = 5_000;
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 10;
const DEFAULT_RETRY_BASE_MS = 1_000;
const DEFAULT_RETRY_MAX_MS = 60_000;

@Injectable()
export class OutboxDispatcherService implements OnModuleInit, OnModuleDestroy {
  private static readonly TIMER_NAME = 'queue-outbox-dispatch';

  private readonly ownerId = randomUUID();
  private readonly logger = new Logger(OutboxDispatcherService.name);

  constructor(
    @InjectRepository(OutboxRepository, DatabaseRole.WRITE)
    private readonly outbox: OutboxRepository,

    private readonly publisher: RMQPublisher,
    private readonly scheduler: SchedulerRegistry,

    @Inject(QUEUE_OUTBOX_OPTIONS)
    private readonly options: QueueOutboxOptions,
  ) {}

  onModuleInit(): void {
    const interval = this.options.intervalMs ?? DEFAULT_INTERVAL_MS;

    const timer = setInterval(() => {
      void this.sweep().catch((error: unknown) => {
        this.logger.error(
          'Outbox dispatch sweep failed',
          error instanceof Error ? error.stack : String(error),
        );
      });
    }, interval);

    timer.unref();

    this.scheduler.addInterval(OutboxDispatcherService.TIMER_NAME, timer);
  }

  onModuleDestroy(): void {
    try {
      this.scheduler.deleteInterval(OutboxDispatcherService.TIMER_NAME);
    } catch {
      // Interval was never registered.
    }
  }

  async sweep(): Promise<void> {
    const batchSize = this.options.batchSize ?? DEFAULT_BATCH_SIZE;
    const leaseMs = this.options.leaseMs ?? DEFAULT_LEASE_MS;

    const claimed = await this.outbox.claimBatch(
      this.ownerId,
      batchSize,
      leaseMs,
    );

    for (const row of claimed) {
      await this.dispatch(row);
    }
  }

  private async dispatch(row: QueueOutboxEntity): Promise<void> {
    try {
      await this.publisher.publish(
        { EXCHANGE_NAME: row.exchange, ROUTING_KEY: row.routingKey },
        row.payload,
        {
          messageId: row.messageId,
          requestId: row.headers?.requestId ?? randomUUID(),
          correlationId: row.headers?.correlationId,
          causationId: row.headers?.causationId,
        },
      );

      await this.outbox.update(
        { id: row.id },
        { status: 'published', publishedAt: new Date(), claimedBy: null },
      );
    } catch (error) {
      await this.markFailedAttempt(row, error);
    }
  }

  private async markFailedAttempt(
    row: QueueOutboxEntity,
    error: unknown,
  ): Promise<void> {
    const attempts = row.attempts + 1;
    const maxAttempts = this.options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const exhausted = attempts >= maxAttempts;

    this.logger.error(
      `Outbox dispatch failed for message '${row.messageId}' ` +
        `(attempt ${attempts}/${maxAttempts})`,
      error instanceof Error ? error.stack : String(error),
    );

    await this.outbox.update(
      { id: row.id },
      {
        status: exhausted ? 'failed' : 'pending',
        attempts,
        lastError: error instanceof Error ? error.message : String(error),
        claimedBy: null,
        nextAttemptAt: exhausted ? null : this.computeBackoff(attempts),
      },
    );

    if (exhausted && this.options.onExhausted) {
      try {
        await this.options.onExhausted({ ...row, attempts, status: 'failed' });
      } catch (hookError) {
        this.logger.error(
          `onExhausted hook failed for message '${row.messageId}'`,
          hookError instanceof Error ? hookError.stack : String(hookError),
        );
      }
    }
  }

  private computeBackoff(attempt: number): Date {
    const baseMs = this.options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
    const maxMs = this.options.retryMaxMs ?? DEFAULT_RETRY_MAX_MS;
    const delay = Math.min(baseMs * 2 ** (attempt - 1), maxMs);
    const jitter = Math.floor(delay * 0.2 * Math.random());

    return new Date(Date.now() + delay + jitter);
  }
}
