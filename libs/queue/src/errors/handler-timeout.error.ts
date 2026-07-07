import { NonRetryableMessageError } from './non-retryable-message.error';

export class HandlerTimeoutError extends NonRetryableMessageError {
  constructor(timeoutMs: number) {
    super(`RabbitMQ handler exceeded timeout of ${timeoutMs}ms`);
    this.name = HandlerTimeoutError.name;
  }
}
