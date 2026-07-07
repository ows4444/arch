import { NonRetryableMessageError } from '../errors/non-retryable-message.error';
import { QueueConfigurationError } from '../errors/queue-configuration.error';

const MAX_PAYLOAD_BYTES = 1024 * 1024 * 5;

export class RMQSerializer {
  static serialize(payload: unknown): Buffer {
    if (payload === undefined) {
      throw new QueueConfigurationError('RabbitMQ payload cannot be undefined');
    }

    let serialized: string;

    try {
      serialized = JSON.stringify(payload);
    } catch (error) {
      throw new NonRetryableMessageError(
        `Failed to serialize RabbitMQ payload: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }

    const buffer = Buffer.from(serialized);

    if (buffer.byteLength > MAX_PAYLOAD_BYTES) {
      throw new NonRetryableMessageError(
        `RabbitMQ payload exceeds ${MAX_PAYLOAD_BYTES} bytes`,
      );
    }

    return buffer;
  }

  static deserialize(buffer: Buffer): unknown {
    if (buffer.length === 0) {
      throw new NonRetryableMessageError('RabbitMQ payload is empty');
    }

    try {
      return JSON.parse(buffer.toString('utf8')) as unknown;
    } catch (error) {
      throw new NonRetryableMessageError(
        `Invalid RabbitMQ JSON payload: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}
