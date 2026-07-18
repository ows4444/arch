import { Inject, Injectable } from '@nestjs/common';
import { CronTime } from 'cron';
import { randomUUID } from 'node:crypto';

import { WORKFLOW_SCHEDULE_STORE } from '../../constants/workflow.tokens';
import { WorkflowConfigurationError } from '../../errors/workflow.errors';
import {
  WorkflowSchedule,
  WorkflowScheduleMisfirePolicy,
} from '../../models/workflow-schedule';
import type { WorkflowScheduleStore } from '../../ports/workflow-schedule.store';
import { WorkflowRegistry } from '../registry/registry';

export interface CreateWorkflowScheduleOptions {
  readonly scheduleId?: string;
  readonly workflowName: string;
  readonly workflowVersion?: number;
  readonly cronExpression: string;
  readonly timezone?: string;
  readonly input?: Record<string, unknown>;
  readonly enabled?: boolean;
  readonly misfirePolicy?: WorkflowScheduleMisfirePolicy;
}

@Injectable()
export class WorkflowScheduleRegistrationService {
  constructor(
    @Inject(WORKFLOW_SCHEDULE_STORE)
    private readonly store: WorkflowScheduleStore,

    private readonly registry: WorkflowRegistry,
  ) {}

  /**
   * Uses the `cron` package already depended on by `@nestjs/schedule`
   * (imported by `WorkflowModule`) rather than adding a new cron-parsing
   * dependency — also doubles as expression validation, since `CronTime`
   * throws on an invalid expression.
   */
  computeNextFireAt(cronExpression: string, timezone?: string): Date {
    try {
      return new CronTime(cronExpression, timezone).sendAt().toJSDate();
    } catch (error) {
      throw new WorkflowConfigurationError(
        `Invalid cron expression '${cronExpression}'${timezone ? ` (timezone '${timezone}')` : ''}: ` +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  async create(
    options: CreateWorkflowScheduleOptions,
  ): Promise<WorkflowSchedule> {
    // Eagerly validate the target workflow+version exists rather than only
    // discovering a typo the first time the schedule fires.
    this.registry.resolve(options.workflowName, options.workflowVersion);

    const nextFireAt = this.computeNextFireAt(
      options.cronExpression,
      options.timezone,
    );

    const now = new Date();

    const schedule: WorkflowSchedule = {
      scheduleId: options.scheduleId ?? randomUUID(),
      workflowName: options.workflowName,
      workflowVersion: options.workflowVersion,
      cronExpression: options.cronExpression,
      timezone: options.timezone,
      inputTemplate: options.input ?? {},
      enabled: options.enabled ?? true,
      nextFireAt,
      misfirePolicy: options.misfirePolicy ?? 'skip',
      createdAt: now,
      updatedAt: now,
    };

    await this.store.insert(schedule);

    return schedule;
  }

  async remove(scheduleId: string): Promise<void> {
    await this.store.delete(scheduleId);
  }

  async setEnabled(scheduleId: string, enabled: boolean): Promise<void> {
    await this.store.setEnabled(scheduleId, enabled);
  }

  async get(scheduleId: string): Promise<WorkflowSchedule | null> {
    return this.store.load(scheduleId);
  }

  async list(): Promise<WorkflowSchedule[]> {
    return this.store.findAll();
  }
}
