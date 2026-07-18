import { WorkflowRetryDelayService } from './delay.service';
import { WorkflowRetryMetadata } from './retry.metadata';

function retry(
  overrides: Partial<WorkflowRetryMetadata>,
): WorkflowRetryMetadata {
  return { strategy: 'fixed', maxAttempts: 3, ...overrides };
}

describe('WorkflowRetryDelayService.compute', () => {
  const service = new WorkflowRetryDelayService();

  it('returns a fixed delay regardless of attempt number', () => {
    expect(service.compute(retry({ delayMs: 500 }), 1)).toBe(500);
    expect(service.compute(retry({ delayMs: 500 }), 5)).toBe(500);
  });

  it('defaults the fixed delay to 1000ms when unspecified', () => {
    expect(service.compute(retry({}), 3)).toBe(1000);
  });

  it('scales linearly with the attempt number', () => {
    expect(
      service.compute(retry({ strategy: 'linear', delayMs: 100 }), 3),
    ).toBe(300);
  });

  it('grows exponentially with the attempt number', () => {
    const config = retry({ strategy: 'exponential', delayMs: 100 });

    expect(service.compute(config, 1)).toBe(100);
    expect(service.compute(config, 2)).toBe(200);
    expect(service.compute(config, 4)).toBe(800);
  });

  it('caps exponential growth at maxDelayMs', () => {
    const config = retry({
      strategy: 'exponential',
      delayMs: 100,
      maxDelayMs: 500,
    });

    expect(service.compute(config, 10)).toBe(500);
  });
});
