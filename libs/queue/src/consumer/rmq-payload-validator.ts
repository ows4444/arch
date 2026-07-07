import { plainToInstance, type ClassConstructor } from 'class-transformer';
import { validateSync } from 'class-validator';
import { NonRetryableMessageError } from '../errors/non-retryable-message.error';
import { formatValidationErrors } from '../utils/validation-errors';

export class RMQPayloadValidator {
  static validate<T>(payloadType: ClassConstructor<T>, payload: unknown): T {
    const instance = plainToInstance(payloadType, payload, {
      enableImplicitConversion: false,
    });

    const errors = validateSync(instance as object, {
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
    });

    if (errors.length === 0) {
      return instance;
    }

    throw new NonRetryableMessageError(
      `Invalid RabbitMQ payload: ${formatValidationErrors(errors)}`,
    );
  }
}
