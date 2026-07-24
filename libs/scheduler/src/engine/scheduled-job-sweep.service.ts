import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { InjectRepository } from '@/database';
import {
  DEFAULT_SCHEDULER_BATCH_SIZE,
  DEFAULT_SCHEDULER_CLAIM_STALE_MS,
  DEFAULT_SCHEDULER_SWEEP_INTERVAL_MS,
  SCHEDULER_MODULE_OPTIONS,
} from '../scheduler.constants';
import type { SchedulerModuleOptions } from '../scheduler.types';
import { ScheduledJobRepository } from '../domain/scheduled-job.repository';
import { ScheduledJobEntity } from '../domain/scheduled-job.entity';
import { ScheduledJobMisfirePolicy } from '../domain/scheduled-job-misfire-policy.enum';
import { ScheduledJobRegistry } from '../discovery/scheduled-job.registry';
import { computeNextFireAt } from './cron-time.util';

/**
 * Same poll-sweep shape as `WorkflowSchedulerService` (`libs/workflow`)
 * exactly: `setInterval` + `SchedulerRegistry` bookkeeping (never
 * `@Cron`/`@Interval`), claim-batch for cross-replica exclusivity, the same
 * missed-fire/misfire-policy check, and the same "release without advancing
 * `nextFireAt` on failure" self-healing behavior. See
 * `libs/scheduler/ARCH.md` Design 001, Application Layer / Reliability
 * Architecture.
 */
@Injectable()
export class ScheduledJobSweepService implements OnModuleInit, OnModuleDestroy {
  private readonly ownerId = randomUUID();
  private readonly logger = new Logger(ScheduledJobSweepService.name);
  private readonly timerName = 'scheduled-job-sweep';
  private readonly sweepIntervalMs: number;
  private readonly claimStaleMs: number;
  private readonly batchSize: number;

  constructor(
    @InjectRepository(ScheduledJobRepository)
    private readonly jobs: ScheduledJobRepository,
    private readonly registry: ScheduledJobRegistry,
    private readonly scheduler: SchedulerRegistry,
    @Inject(SCHEDULER_MODULE_OPTIONS)
    options: SchedulerModuleOptions,
  ) {
    this.sweepIntervalMs =
      options.sweepIntervalMs ?? DEFAULT_SCHEDULER_SWEEP_INTERVAL_MS;
    this.claimStaleMs =
      options.claimStaleMs ?? DEFAULT_SCHEDULER_CLAIM_STALE_MS;
    this.batchSize = options.batchSize ?? DEFAULT_SCHEDULER_BATCH_SIZE;
  }

  onModuleInit(): void {
    const timer = setInterval(() => {
      void this.sweep().catch((error: unknown) => {
        this.logger.error(
          'Scheduled job sweep failed',
          error instanceof Error ? error.stack : String(error),
        );
      });
    }, this.sweepIntervalMs);

    timer.unref();
    this.scheduler.addInterval(this.timerName, timer);
  }

  onModuleDestroy(): void {
    try {
      this.scheduler.deleteInterval(this.timerName);
    } catch {
      // Interval was never registered.
    }
  }

  async sweep(): Promise<void> {
    const now = new Date();

    const claimed = await this.jobs.claimDue(
      this.ownerId,
      now,
      this.claimStaleMs,
      this.batchSize,
    );

    for (const job of claimed) {
      await this.fire(job, now);
    }
  }

  private async fire(job: ScheduledJobEntity, now: Date): Promise<void> {
    const definition = this.registry.getDefinition(job.name);

    if (!definition) {
      // The row exists but no handler in this process registered it (e.g.
      // the @ScheduledJob was removed from code but the row wasn't cleaned
      // up — see ARCH.md Open Questions). Advancing nextFireAt (via the
      // job's own stored cron fields, not a handler) rather than just
      // releasing is deliberate: every replica runs the same deployed code,
      // so if this replica has no handler for it, none of them do, and a
      // release-without-advancing would leave nextFireAt in the past —
      // reclaimed and logged again on every single sweep, forever, instead
      // of once. Caught in this library's Loop 002 review.
      this.logger.warn(
        `No handler registered for scheduled job '${job.name}' — skipping and advancing past this fire time.`,
      );
      const nextFireAt = computeNextFireAt(
        job.cronExpression,
        job.timezone ?? undefined,
      );
      await this.jobs.recordFired(job.name, now, nextFireAt);
      return;
    }

    // A job claimed more than one sweep interval after its nextFireAt missed
    // its on-time window (e.g. the process was down) — apply the configured
    // misfire policy rather than always firing.
    const missed =
      now.getTime() - job.nextFireAt.getTime() > this.sweepIntervalMs;
    const shouldFire =
      !missed ||
      definition.metadata.misfirePolicy === ScheduledJobMisfirePolicy.FIRE_ONCE;

    try {
      if (shouldFire) {
        await definition.invoke();
      } else {
        this.logger.warn(
          `Scheduled job '${job.name}' missed its nextFireAt=${job.nextFireAt.toISOString()} ` +
            `and misfirePolicy is 'skip' — advancing without firing.`,
        );
      }

      const nextFireAt = computeNextFireAt(
        job.cronExpression,
        job.timezone ?? undefined,
      );

      await this.jobs.recordFired(job.name, now, nextFireAt);
    } catch (error) {
      this.logger.error(
        `Scheduled job '${job.name}' failed`,
        error instanceof Error ? error.stack : String(error),
      );

      // Not advancing nextFireAt is deliberate: the next sweep's
      // missed-fire check will convert this into a misfire-policy-driven
      // skip-and-reschedule rather than an immediate retry loop — see
      // ARCH.md Key Decisions MEDIUM #2.
      await this.jobs.release(job.name);
    }
  }
}
