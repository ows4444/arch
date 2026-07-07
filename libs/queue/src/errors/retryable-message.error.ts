export class RetryableMessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = RetryableMessageError.name;
  }
}
