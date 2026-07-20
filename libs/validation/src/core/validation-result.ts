import type { ValidationFailure } from './validation-failure.interface';

export class ValidationResult {
  private constructor(public readonly failures: readonly ValidationFailure[]) {}

  static success(): ValidationResult {
    return new ValidationResult([]);
  }

  static failure(failures: readonly ValidationFailure[]): ValidationResult {
    return new ValidationResult(failures);
  }

  get isValid(): boolean {
    return this.failures.length === 0;
  }

  get messages(): string[] {
    return this.failures.flatMap((failure) => failure.messages);
  }
}
