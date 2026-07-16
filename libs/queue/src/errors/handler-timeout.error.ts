import { RetryableMessageError } from './retryable-message.error';

export class HandlerTimeoutError extends RetryableMessageError {
  constructor(timeoutMs: number) {
    super(`RabbitMQ handler exceeded timeout of ${timeoutMs}ms`);
    this.name = HandlerTimeoutError.name;
  }
}
