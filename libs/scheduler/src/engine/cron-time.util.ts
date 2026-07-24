import { CronTime } from 'cron';
import { SchedulerConfigurationError } from '../errors/scheduler-configuration.error';

/**
 * Uses the `cron` package already depended on by `@nestjs/schedule` rather
 * than adding a new cron-parsing dependency — the same reuse
 * `WorkflowScheduleRegistrationService` (`libs/workflow`) already
 * established. Also doubles as expression validation, since `CronTime`
 * throws on an invalid expression.
 */
export function computeNextFireAt(
  cronExpression: string,
  timezone?: string,
): Date {
  try {
    return new CronTime(cronExpression, timezone).sendAt().toJSDate();
  } catch (error) {
    throw new SchedulerConfigurationError(
      `Invalid cron expression '${cronExpression}'${timezone ? ` (timezone '${timezone}')` : ''}: ` +
        (error instanceof Error ? error.message : String(error)),
    );
  }
}
