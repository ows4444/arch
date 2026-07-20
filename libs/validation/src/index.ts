export * from './core/specification.interface';
export * from './core/composite-specifications';
export * from './core/validation-failure.interface';
export * from './core/validation-result';

export * from './class-validator/class-validator.specification';
export * from './class-validator/format-validation-errors';

export * from './errors/validation-failed.error';
export * from './errors/validation-error-factory.interface';
export * from './errors/default-validation-error-factory';
export * from './errors/validation-rule-not-found.error';

export * from './nest/validation.service';
export * from './nest/validation.module';
export * from './nest/validation.module-options.interface';

export * from './rules/validation-rule-operator.enum';
export * from './rules/stored-rule.interface';
export * from './rules/rule-evaluator';
export * from './rules/stored-condition.specification';
export * from './rules/validation-rule-store.interface';
export * from './rules/noop-validation-rule-store';
export * from './rules/database-validation-rule.store';
export * from './rules/cached-validation-rule.store';
export * from './rules/validation-rule.service';
export * from './rules/validation-rule-admin.service';

export {
  ValidationRuleEntity,
  VALIDATION_TYPEORM_ENTITIES,
} from './persistence/entities';
export {
  ValidationRuleRepository,
  type CreateValidationRuleInput,
  type UpdateValidationRuleInput,
} from './persistence/validation-rule.repository';
export {
  CreateValidationRuleTable1753200000000,
  VALIDATION_MIGRATIONS,
} from './persistence/migrations';
