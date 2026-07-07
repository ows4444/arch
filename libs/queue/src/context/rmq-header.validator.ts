import type { RMQPublishHeaders } from '../publisher/rmq-publish-headers';
import { RMQ_HEADERS } from '../queue.constants';
import { RMQHeaderParser } from './rmq-header.parser';
import type { RMQHeadersDto } from './rmq-headers.dto';

export class RMQHeaderValidator {
  static validate(headers: RMQPublishHeaders): RMQHeadersDto {
    return RMQHeaderParser.parse({
      [RMQ_HEADERS.REQUEST_ID]: headers.requestId,
      [RMQ_HEADERS.CORRELATION_ID]: headers.correlationId,
      [RMQ_HEADERS.CAUSATION_ID]: headers.causationId,
    });
  }
}
