import type { ClassConstructor } from 'class-transformer';
import {
  ClassValidatorSpecification,
  ClassValidatorSpecificationError,
} from '@/validation';
import { NonRetryableMessageError } from '../errors/non-retryable-message.error';

export class RMQPayloadValidator {
  static validate<T>(payloadType: ClassConstructor<T>, payload: unknown): T {
    const specification = new ClassValidatorSpecification(
      payloadType as ClassConstructor<T & object>,
    );

    try {
      return specification.toInstance(payload);
    } catch (error) {
      if (error instanceof ClassValidatorSpecificationError) {
        throw new NonRetryableMessageError(
          `Invalid RabbitMQ payload: ${error.messages.join(', ')}`,
        );
      }

      throw error;
    }
  }
}
