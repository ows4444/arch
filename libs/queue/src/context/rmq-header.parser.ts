import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { NonRetryableMessageError } from '../errors/non-retryable-message.error';
import { RMQ_HEADERS } from '../queue.constants';
import { parseIntegerHeader } from '../utils/header-utils';
import { formatValidationErrors } from '../utils/validation-errors';
import { RMQHeadersDto } from './rmq-headers.dto';

export class RMQHeaderParser {
  static parse(headers: Record<string, unknown>): RMQHeadersDto {
    const dto = plainToInstance(RMQHeadersDto, {
      requestId: headers[RMQ_HEADERS.REQUEST_ID],
      correlationId: headers[RMQ_HEADERS.CORRELATION_ID],
      causationId: headers[RMQ_HEADERS.CAUSATION_ID],
      retryCount: parseIntegerHeader(headers[RMQ_HEADERS.RETRY_COUNT]),
    });

    const errors = validateSync(dto, {
      whitelist: true,
      forbidNonWhitelisted: false,
      forbidUnknownValues: true,
    });

    if (errors.length === 0) {
      return dto;
    }

    throw new NonRetryableMessageError(
      `Invalid RabbitMQ headers: ${formatValidationErrors(errors)}`,
    );
  }
}
