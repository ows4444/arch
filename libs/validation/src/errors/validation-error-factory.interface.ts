import type { ValidationFailure } from '../core/validation-failure.interface';

/**
 * Translates a validation failure into whatever error type the consuming context expects
 * (a Nest `BadRequestException`, `NonRetryableMessageError`, a workflow-specific error, ...).
 * Injected via `VALIDATION_ERROR_FACTORY` so `libs/validation` never hardcodes a consumer's
 * error shape.
 */
export interface ValidationErrorFactory {
  createError(failures: readonly ValidationFailure[]): Error;
}

export const VALIDATION_ERROR_FACTORY = Symbol('VALIDATION_ERROR_FACTORY');
