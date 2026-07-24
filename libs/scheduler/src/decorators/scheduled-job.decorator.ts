import { SetMetadata } from '@nestjs/common';
import {
  DEFAULT_SCHEDULED_JOB_TIMEZONE,
  SCHEDULED_JOB_METADATA,
} from '../scheduler.constants';
import { ScheduledJobMisfirePolicy } from '../domain/scheduled-job-misfire-policy.enum';

export interface ScheduledJobOptions {
  timezone?: string;
  misfirePolicy?: ScheduledJobMisfirePolicy;
  enabled?: boolean;
}

export interface ScheduledJobMetadata {
  name: string;
  cronExpression: string;
  timezone: string;
  misfirePolicy: ScheduledJobMisfirePolicy;
  enabled: boolean;
}

/**
 * Marks a method as a recurring job, discovered at boot the same way
 * `@RMQConsumer` is (`DiscoveryService` + `MetadataScanner` scan over every
 * provider). `name` is the job's stable identity — see
 * `libs/scheduler/ARCH.md` Design 001, Key Decisions MEDIUM #1 for why it's
 * also the entity's primary key. Code is the source of truth for
 * `cronExpression`/`timezone`/`misfirePolicy`/`enabled`; the database only
 * tracks cross-replica claim/fire state (Key Decisions HIGH #1).
 *
 * `timezone` defaults to UTC, not the host process's local system timezone
 * — see `libs/scheduler/LOOP.md` Loop 003 for the live-verification-only
 * bug that motivated this (a job's cron evaluation silently drifting by
 * whatever offset the deploying process happens to run under).
 */
export const ScheduledJob = (
  name: string,
  cronExpression: string,
  options: ScheduledJobOptions = {},
): MethodDecorator =>
  SetMetadata(SCHEDULED_JOB_METADATA, {
    name,
    cronExpression,
    timezone: options.timezone ?? DEFAULT_SCHEDULED_JOB_TIMEZONE,
    misfirePolicy: options.misfirePolicy ?? ScheduledJobMisfirePolicy.SKIP,
    enabled: options.enabled ?? true,
  } satisfies ScheduledJobMetadata);
