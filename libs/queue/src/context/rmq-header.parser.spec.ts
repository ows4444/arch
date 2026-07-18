import { RMQHeaderParser } from './rmq-header.parser';
import { RMQ_HEADERS } from '../queue.constants';
import { NonRetryableMessageError } from '../errors/non-retryable-message.error';

const REQUEST_ID = '6e32be35-96d6-4cc8-9d4a-22bb9ac7edd9';
const CORRELATION_ID = '3c3f0e2a-6f0b-4c1a-9c1a-0f5e2b7a9d10';

describe('RMQHeaderParser.parse', () => {
  it('parses a valid header set', () => {
    const dto = RMQHeaderParser.parse({
      [RMQ_HEADERS.REQUEST_ID]: REQUEST_ID,
      [RMQ_HEADERS.CORRELATION_ID]: CORRELATION_ID,
      [RMQ_HEADERS.RETRY_COUNT]: 2,
    });

    expect(dto.requestId).toBe(REQUEST_ID);
    expect(dto.correlationId).toBe(CORRELATION_ID);
    expect(dto.retryCount).toBe(2);
  });

  it('allows correlationId/causationId/retryCount to be omitted', () => {
    const dto = RMQHeaderParser.parse({
      [RMQ_HEADERS.REQUEST_ID]: REQUEST_ID,
    });

    expect(dto.requestId).toBe(REQUEST_ID);
    expect(dto.correlationId).toBeUndefined();
    expect(dto.retryCount).toBeUndefined();
  });

  it('throws NonRetryableMessageError when requestId is missing', () => {
    expect(() => RMQHeaderParser.parse({})).toThrow(NonRetryableMessageError);
  });

  it('throws NonRetryableMessageError when requestId is not a UUID', () => {
    expect(() =>
      RMQHeaderParser.parse({ [RMQ_HEADERS.REQUEST_ID]: 'not-a-uuid' }),
    ).toThrow(NonRetryableMessageError);
  });

  it('throws NonRetryableMessageError when correlationId is not a UUID', () => {
    expect(() =>
      RMQHeaderParser.parse({
        [RMQ_HEADERS.REQUEST_ID]: REQUEST_ID,
        [RMQ_HEADERS.CORRELATION_ID]: 'not-a-uuid',
      }),
    ).toThrow(NonRetryableMessageError);
  });
});
