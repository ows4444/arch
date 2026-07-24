import { computeNextFireAt } from './cron-time.util';
import { SchedulerConfigurationError } from '../errors/scheduler-configuration.error';

describe('computeNextFireAt', () => {
  it('returns a Date in the future for a valid cron expression', () => {
    const nextFireAt = computeNextFireAt('*/5 * * * *');

    expect(nextFireAt).toBeInstanceOf(Date);
    expect(nextFireAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('accepts an explicit timezone', () => {
    const nextFireAt = computeNextFireAt('0 2 * * *', 'UTC');

    expect(nextFireAt).toBeInstanceOf(Date);
  });

  it('throws SchedulerConfigurationError for an invalid cron expression', () => {
    expect(() => computeNextFireAt('not-a-cron-expression')).toThrow(
      SchedulerConfigurationError,
    );
  });
});
