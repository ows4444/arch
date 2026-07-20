import type { Specification } from '../core/specification.interface';
import { ValidationService } from './validation.service';
import { ValidationFailedError } from '../errors/validation-failed.error';
import type { ValidationErrorFactory } from '../errors/validation-error-factory.interface';

function spec(name: string, satisfied: boolean): Specification<unknown> {
  return {
    name,
    isSatisfiedBy: () => satisfied,
    explain: () => (satisfied ? [] : [`${name} failed`]),
  };
}

describe('ValidationService', () => {
  it('returns a valid result when all specifications pass', async () => {
    const service = new ValidationService();
    const result = await service.validate({}, [
      spec('a', true),
      spec('b', true),
    ]);
    expect(result.isValid).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('collects failures from every failing specification', async () => {
    const service = new ValidationService();
    const result = await service.validate({}, [
      spec('a', false),
      spec('b', true),
      spec('c', false),
    ]);
    expect(result.isValid).toBe(false);
    expect(result.failures.map((f) => f.specification)).toEqual(['a', 'c']);
    expect(result.messages).toEqual(['a failed', 'c failed']);
  });

  it('validateOrThrow throws the default ValidationFailedError when no factory is provided', async () => {
    const service = new ValidationService();
    await expect(
      service.validateOrThrow({}, [spec('a', false)]),
    ).rejects.toBeInstanceOf(ValidationFailedError);
  });

  it('validateOrThrow delegates to an injected error factory', async () => {
    class CustomError extends Error {}
    const factory: ValidationErrorFactory = {
      createError: () => new CustomError('custom'),
    };
    const service = new ValidationService(factory);

    await expect(
      service.validateOrThrow({}, [spec('a', false)]),
    ).rejects.toBeInstanceOf(CustomError);
  });

  it('validateOrThrow resolves when validation passes', async () => {
    const service = new ValidationService();
    await expect(
      service.validateOrThrow({}, [spec('a', true)]),
    ).resolves.toBeUndefined();
  });
});
