import { RMQHeaderValidator } from './rmq-header.validator';
import { NonRetryableMessageError } from '../errors/non-retryable-message.error';

const REQUEST_ID = '6e32be35-96d6-4cc8-9d4a-22bb9ac7edd9';

describe('RMQHeaderValidator.validate', () => {
  it('returns a parsed DTO for valid publish headers', () => {
    const dto = RMQHeaderValidator.validate({ requestId: REQUEST_ID });

    expect(dto.requestId).toBe(REQUEST_ID);
  });

  it('throws NonRetryableMessageError for an invalid requestId', () => {
    expect(() =>
      RMQHeaderValidator.validate({ requestId: 'not-a-uuid' }),
    ).toThrow(NonRetryableMessageError);
  });
});
