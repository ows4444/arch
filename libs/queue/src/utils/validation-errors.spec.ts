import type { ValidationError } from 'class-validator';
import { formatValidationErrors } from './validation-errors';

function error(overrides: Partial<ValidationError>): ValidationError {
  return { property: 'field', ...overrides } as ValidationError;
}

describe('formatValidationErrors', () => {
  it('joins constraint messages from a single error', () => {
    const result = formatValidationErrors([
      error({ constraints: { isUuid: 'must be a UUID', isEmpty: 'required' } }),
    ]);

    expect(result).toBe('must be a UUID, required');
  });

  it('joins constraint messages across multiple errors', () => {
    const result = formatValidationErrors([
      error({ constraints: { isUuid: 'must be a UUID' } }),
      error({ constraints: { min: 'too small' } }),
    ]);

    expect(result).toBe('must be a UUID, too small');
  });

  it('recurses into nested children', () => {
    const result = formatValidationErrors([
      error({
        children: [error({ constraints: { isString: 'must be a string' } })],
      }),
    ]);

    expect(result).toBe('must be a string');
  });

  it('returns an empty string for no errors', () => {
    expect(formatValidationErrors([])).toBe('');
  });
});
