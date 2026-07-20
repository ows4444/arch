import { plainToInstance, type ClassConstructor } from 'class-transformer';
import { validateSync, type ValidatorOptions } from 'class-validator';
import type { Specification } from '../core/specification.interface';
import { formatValidationErrors } from './format-validation-errors';

const DEFAULT_OPTIONS: ValidatorOptions = {
  whitelist: true,
  forbidNonWhitelisted: true,
  forbidUnknownValues: true,
};

/**
 * Adapts a class-validator-decorated class into a `Specification<unknown>` so shape
 * validation composes with `and`/`or`/`not` alongside business-rule specifications.
 */
export class ClassValidatorSpecification<
  T extends object,
> implements Specification<unknown> {
  readonly name: string;

  constructor(
    private readonly type: ClassConstructor<T>,
    private readonly options: ValidatorOptions = DEFAULT_OPTIONS,
  ) {
    this.name = `ClassValidatorSpecification<${type.name}>`;
  }

  isSatisfiedBy(candidate: unknown): boolean {
    return this.validate(candidate).errors.length === 0;
  }

  explain(candidate: unknown): string[] {
    return formatValidationErrors(this.validate(candidate).errors);
  }

  /** Transforms and validates `candidate`, returning the typed instance on success. */
  toInstance(candidate: unknown): T {
    const { instance, errors } = this.validate(candidate);

    if (errors.length > 0) {
      throw new ClassValidatorSpecificationError(
        this.name,
        formatValidationErrors(errors),
      );
    }

    return instance;
  }

  private validate(candidate: unknown) {
    const instance = plainToInstance(this.type, candidate, {
      enableImplicitConversion: false,
    });
    const errors = validateSync(instance as object, this.options);

    return { instance, errors };
  }
}

export class ClassValidatorSpecificationError extends Error {
  constructor(
    public readonly specification: string,
    public readonly messages: string[],
  ) {
    super(`${specification} failed: ${messages.join(', ')}`);
    this.name = ClassValidatorSpecificationError.name;
  }
}
