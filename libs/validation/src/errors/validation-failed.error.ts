import type { ValidationFailure } from '../core/validation-failure.interface';

export class ValidationFailedError extends Error {
  constructor(public readonly failures: readonly ValidationFailure[]) {
    super(
      `Validation failed: ${failures.flatMap((failure) => failure.messages).join(', ')}`,
    );
    this.name = ValidationFailedError.name;
  }
}
