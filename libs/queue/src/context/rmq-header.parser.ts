import {
  ClassValidatorSpecification,
  ClassValidatorSpecificationError,
} from '@/validation';
import { NonRetryableMessageError } from '../errors/non-retryable-message.error';
import { RMQ_HEADERS } from '../queue.constants';
import { parseIntegerHeader } from '../utils/header-utils';
import { RMQHeadersDto } from './rmq-headers.dto';

const HEADERS_SPECIFICATION = new ClassValidatorSpecification(RMQHeadersDto, {
  whitelist: true,
  forbidNonWhitelisted: false,
  forbidUnknownValues: true,
});

export class RMQHeaderParser {
  static parse(headers: Record<string, unknown>): RMQHeadersDto {
    const candidate = {
      requestId: headers[RMQ_HEADERS.REQUEST_ID],
      correlationId: headers[RMQ_HEADERS.CORRELATION_ID],
      causationId: headers[RMQ_HEADERS.CAUSATION_ID],
      retryCount: parseIntegerHeader(headers[RMQ_HEADERS.RETRY_COUNT]),
    };

    try {
      return HEADERS_SPECIFICATION.toInstance(candidate);
    } catch (error) {
      if (error instanceof ClassValidatorSpecificationError) {
        throw new NonRetryableMessageError(
          `Invalid RabbitMQ headers: ${error.messages.join(', ')}`,
        );
      }

      throw error;
    }
  }
}
