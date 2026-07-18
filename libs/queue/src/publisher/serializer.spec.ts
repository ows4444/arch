import { RMQSerializer } from './serializer';
import { QueueConfigurationError } from '../errors/queue-configuration.error';
import { NonRetryableMessageError } from '../errors/non-retryable-message.error';

describe('RMQSerializer.serialize', () => {
  it('serializes a plain object to a JSON buffer', () => {
    const buffer = RMQSerializer.serialize({ a: 1 });

    expect(buffer).toBeInstanceOf(Buffer);
    expect(JSON.parse(buffer.toString('utf8'))).toEqual({ a: 1 });
  });

  it('throws QueueConfigurationError for an undefined payload', () => {
    expect(() => RMQSerializer.serialize(undefined)).toThrow(
      QueueConfigurationError,
    );
  });

  it('throws NonRetryableMessageError for a payload that cannot be JSON-stringified (circular ref)', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => RMQSerializer.serialize(circular)).toThrow(
      NonRetryableMessageError,
    );
  });

  it('throws NonRetryableMessageError when the serialized payload exceeds the size limit', () => {
    const huge = { data: 'x'.repeat(6 * 1024 * 1024) };

    expect(() => RMQSerializer.serialize(huge)).toThrow(
      NonRetryableMessageError,
    );
  });
});

describe('RMQSerializer.deserialize', () => {
  it('parses a valid JSON buffer', () => {
    const buffer = Buffer.from(JSON.stringify({ a: 1 }));

    expect(RMQSerializer.deserialize(buffer)).toEqual({ a: 1 });
  });

  it('throws NonRetryableMessageError for an empty buffer', () => {
    expect(() => RMQSerializer.deserialize(Buffer.alloc(0))).toThrow(
      NonRetryableMessageError,
    );
  });

  it('throws NonRetryableMessageError for invalid JSON', () => {
    expect(() => RMQSerializer.deserialize(Buffer.from('not json'))).toThrow(
      NonRetryableMessageError,
    );
  });
});
