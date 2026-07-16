import { DefaultWorkflowRetryJitterService } from './default-jitter.service';

describe('DefaultWorkflowRetryJitterService', () => {
  const jitter = new DefaultWorkflowRetryJitterService();

  it('returns a value within [0, baseDelayMs)', () => {
    for (let attempt = 1; attempt <= 5; attempt++) {
      for (let i = 0; i < 50; i++) {
        const result = jitter.apply(1000, attempt);

        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThan(1000);
      }
    }
  });

  it('returns 0 when baseDelayMs is 0', () => {
    expect(jitter.apply(0, 1)).toBe(0);
  });

  it('returns an integer', () => {
    expect(Number.isInteger(jitter.apply(500, 1))).toBe(true);
  });
});
