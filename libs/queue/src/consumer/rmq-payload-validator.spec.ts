import { IsInt, IsString } from 'class-validator';
import { RMQPayloadValidator } from './rmq-payload-validator';
import { NonRetryableMessageError } from '../errors/non-retryable-message.error';

class OrderPayload {
  @IsString()
  id!: string;

  @IsInt()
  quantity!: number;
}

describe('RMQPayloadValidator.validate', () => {
  it('returns a validated instance for a well-formed payload', () => {
    const result = RMQPayloadValidator.validate(OrderPayload, {
      id: 'order-1',
      quantity: 3,
    });

    expect(result).toBeInstanceOf(OrderPayload);
    expect(result).toEqual({ id: 'order-1', quantity: 3 });
  });

  it('throws NonRetryableMessageError for a type mismatch', () => {
    expect(() =>
      RMQPayloadValidator.validate(OrderPayload, {
        id: 'order-1',
        quantity: 'not-a-number',
      }),
    ).toThrow(NonRetryableMessageError);
  });

  it('throws NonRetryableMessageError for a missing required field', () => {
    expect(() =>
      RMQPayloadValidator.validate(OrderPayload, { id: 'order-1' }),
    ).toThrow(NonRetryableMessageError);
  });

  it('throws NonRetryableMessageError for unknown extra fields (whitelist)', () => {
    expect(() =>
      RMQPayloadValidator.validate(OrderPayload, {
        id: 'order-1',
        quantity: 3,
        extra: 'nope',
      }),
    ).toThrow(NonRetryableMessageError);
  });
});
