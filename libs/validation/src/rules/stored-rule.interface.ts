import type { ValidationRuleOperator } from './validation-rule-operator.enum';

/**
 * Framework-agnostic shape of a persisted validation rule — decoupled from
 * `ValidationRuleEntity` so `StoredConditionSpecification` doesn't depend on TypeORM.
 */
export interface StoredRule {
  readonly id: number;
  readonly targetType: string;
  readonly field: string;
  readonly operator: ValidationRuleOperator;
  readonly value: unknown;
  /**
   * When set, compares `candidate[field]` against `candidate[compareField]` instead of `value`.
   * Restricted to equals/not_equals/greater_than(_or_equal)/less_than(_or_equal) at evaluation
   * time — see ARCH.md Design 005.
   */
  readonly compareField: string | null;
  readonly message: string | null;
}
