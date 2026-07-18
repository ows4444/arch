import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';

import {
  DEFAULT_SCHEDULER_BATCH_SIZE,
  DEFAULT_SCHEDULER_CLAIM_STALE_MS,
  DEFAULT_SCHEDULER_SWEEP_INTERVAL_MS,
} from '../../constants/workflow.constants';
import { WORKFLOW_SCHEDULE_STORE } from '../../constants/workflow.tokens';
import { WorkflowSchedule } from '../../models/workflow-schedule';
import type { WorkflowScheduleStore } from '../../ports/workflow-schedule.store';
import { WorkflowExecutor } from '../executor/executor';
import { WorkflowScheduleRegistrationService } from './schedule-registration.service';

@Injectable()
export class WorkflowSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly ownerId = randomUUID();
  private readonly logger = new Logger(WorkflowSchedulerService.name);
  private readonly timerName = 'workflow-scheduler-sweep';

  constructor(
    @Inject(WORKFLOW_SCHEDULE_STORE)
    private readonly store: WorkflowScheduleStore,

    private readonly executor: WorkflowExecutor,
    private readonly registration: WorkflowScheduleRegistrationService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const timer = setInterval(() => {
      void this.sweep().catch((error: unknown) => {
        this.logger.error(
          'Schedule sweep failed',
          error instanceof Error ? error.stack : String(error),
        );
      });
    }, DEFAULT_SCHEDULER_SWEEP_INTERVAL_MS);

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

    const claimed = await this.store.claimDue(
      this.ownerId,
      now,
      DEFAULT_SCHEDULER_CLAIM_STALE_MS,
      DEFAULT_SCHEDULER_BATCH_SIZE,
    );

    for (const schedule of claimed) {
      await this.fire(schedule, now);
    }
  }

  private async fire(schedule: WorkflowSchedule, now: Date): Promise<void> {
    // A schedule claimed more than one sweep interval after its nextFireAt
    // missed its on-time window (e.g. the process was down) — apply the
    // configured misfire policy rather than always firing.
    const missed =
      now.getTime() - schedule.nextFireAt.getTime() >
      DEFAULT_SCHEDULER_SWEEP_INTERVAL_MS;
    const shouldFire = !missed || schedule.misfirePolicy === 'fire-once';

    try {
      if (shouldFire) {
        await this.executor.execute(
          schedule.workflowName,
          schedule.inputTemplate,
          { workflowVersion: schedule.workflowVersion },
        );
      } else {
        this.logger.warn(
          `Schedule '${schedule.scheduleId}' missed its nextFireAt=${schedule.nextFireAt.toISOString()} ` +
            `and misfirePolicy is 'skip' — advancing without firing.`,
        );
      }

      const nextFireAt = this.registration.computeNextFireAt(
        schedule.cronExpression,
        schedule.timezone,
      );

      await this.store.recordFired(schedule.scheduleId, now, nextFireAt);
    } catch (error) {
      this.logger.error(
        `Failed to fire schedule '${schedule.scheduleId}' for workflow '${schedule.workflowName}'`,
        error instanceof Error ? error.stack : String(error),
      );

      await this.store.release(schedule.scheduleId);
    }
  }
}
