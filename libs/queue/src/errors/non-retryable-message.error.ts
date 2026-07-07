export class NonRetryableMessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = NonRetryableMessageError.name;
  }
}
