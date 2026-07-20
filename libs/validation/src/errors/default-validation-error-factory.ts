import { Injectable } from '@nestjs/common';
import type { ValidationFailure } from '../core/validation-failure.interface';
import type { ValidationErrorFactory } from './validation-error-factory.interface';
import { ValidationFailedError } from './validation-failed.error';

@Injectable()
export class DefaultValidationErrorFactory implements ValidationErrorFactory {
  createError(failures: readonly ValidationFailure[]): Error {
    return new ValidationFailedError(failures);
  }
}
