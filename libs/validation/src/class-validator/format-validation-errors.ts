import type { ValidationError } from 'class-validator';

export function formatValidationErrors(errors: ValidationError[]): string[] {
  return errors.flatMap((error) => collectConstraints(error));
}

function collectConstraints(error: ValidationError): string[] {
  const own = Object.values(error.constraints ?? {});
  const nested = (error.children ?? []).flatMap((child) =>
    collectConstraints(child),
  );

  return [...own, ...nested];
}
