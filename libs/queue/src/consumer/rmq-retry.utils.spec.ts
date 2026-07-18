import type { ConsumeMessage } from 'amqplib';
import { getRetryCount } from './rmq-retry.utils';
import { RMQ_HEADERS } from '../queue.constants';

function fakeMessage(headers: Record<string, unknown> = {}): ConsumeMessage {
  return {
    properties: { headers },
  } as unknown as ConsumeMessage;
}

describe('getRetryCount', () => {
  it('returns 0 when the retry-count header is absent', () => {
    expect(getRetryCount(fakeMessage())).toBe(0);
  });

  it('returns the parsed retry count from the header', () => {
    const message = fakeMessage({ [RMQ_HEADERS.RETRY_COUNT]: 3 });

    expect(getRetryCount(message)).toBe(3);
  });

  it('normalizes a negative retry count to 0', () => {
    const message = fakeMessage({ [RMQ_HEADERS.RETRY_COUNT]: -1 });

    expect(getRetryCount(message)).toBe(0);
  });

  it('normalizes a non-integer retry count to 0', () => {
    const message = fakeMessage({ [RMQ_HEADERS.RETRY_COUNT]: 'not-a-number' });

    expect(getRetryCount(message)).toBe(0);
  });

  it('normalizes a retry count above the max allowed value to 0', () => {
    const message = fakeMessage({ [RMQ_HEADERS.RETRY_COUNT]: 1_001 });

    expect(getRetryCount(message)).toBe(0);
  });
});
