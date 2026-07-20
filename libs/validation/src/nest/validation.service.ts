import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Specification } from '../core/specification.interface';
import type { ValidationFailure } from '../core/validation-failure.interface';
import { ValidationResult } from '../core/validation-result';
import {
  VALIDATION_ERROR_FACTORY,
  type ValidationErrorFactory,
} from '../errors/validation-error-factory.interface';
import { DefaultValidationErrorFactory } from '../errors/default-validation-error-factory';

@Injectable()
export class ValidationService {
  constructor(
    @Optional()
    @Inject(VALIDATION_ERROR_FACTORY)
    private readonly errorFactory: ValidationErrorFactory = new DefaultValidationErrorFactory(),
  ) {}

  async validate<T>(
    candidate: T,
    specifications: readonly Specification<T>[],
  ): Promise<ValidationResult> {
    const failures: ValidationFailure[] = [];

    for (const specification of specifications) {
      if (!(await specification.isSatisfiedBy(candidate))) {
        failures.push({
          specification: specification.name,
          messages: await specification.explain(candidate),
        });
      }
    }

    return failures.length === 0
      ? ValidationResult.success()
      : ValidationResult.failure(failures);
  }

  async validateOrThrow<T>(
    candidate: T,
    specifications: readonly Specification<T>[],
  ): Promise<void> {
    const result = await this.validate(candidate, specifications);

    if (!result.isValid) {
      throw this.errorFactory.createError(result.failures);
    }
  }
}
