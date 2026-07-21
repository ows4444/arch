import { ValidationRuleOperator } from './validation-rule-operator.enum';
import type { StoredRule } from './stored-rule.interface';

export interface RuleEvaluation {
  readonly satisfied: boolean;
  readonly reason: string | null;
}

/**
 * Evaluates one stored rule against a candidate's field. Fails closed (not satisfied, with an
 * explanatory reason) when the operand types don't fit the operator, rather than silently
 * coercing or silently passing — a misconfigured stored rule should surface as a validation
 * failure. See libs/validation/ARCH.md, Design 002, MEDIUM decisions.
 *
 * `rule.compareField`, when set, compares `candidate[field]` against `candidate[compareField]`
 * instead of `rule.value`, for every operator (see ARCH.md Design 006 — `in`/`not_in`/
 * `contains`/`not_contains` were initially restricted in Design 005, then extended once the
 * "what does 'the other field is an array' mean" question turned out to have the same answer
 * as the literal-value case).
 */
export function evaluateStoredRule(
  candidate: unknown,
  rule: StoredRule,
): RuleEvaluation {
  const fieldValue = (candidate as Record<string, unknown>)?.[rule.field];
  const comparisonValue = rule.compareField
    ? (candidate as Record<string, unknown>)?.[rule.compareField]
    : rule.value;

  switch (rule.operator) {
    case ValidationRuleOperator.EQUALS:
      return { satisfied: fieldValue === comparisonValue, reason: null };

    case ValidationRuleOperator.NOT_EQUALS:
      return { satisfied: fieldValue !== comparisonValue, reason: null };

    case ValidationRuleOperator.GREATER_THAN:
      return evaluateNumericComparison(
        rule,
        fieldValue,
        comparisonValue,
        (a, b) => a > b,
      );

    case ValidationRuleOperator.GREATER_THAN_OR_EQUAL:
      return evaluateNumericComparison(
        rule,
        fieldValue,
        comparisonValue,
        (a, b) => a >= b,
      );

    case ValidationRuleOperator.LESS_THAN:
      return evaluateNumericComparison(
        rule,
        fieldValue,
        comparisonValue,
        (a, b) => a < b,
      );

    case ValidationRuleOperator.LESS_THAN_OR_EQUAL:
      return evaluateNumericComparison(
        rule,
        fieldValue,
        comparisonValue,
        (a, b) => a <= b,
      );

    case ValidationRuleOperator.IN:
      return evaluateMembership(rule, fieldValue, comparisonValue, true);

    case ValidationRuleOperator.NOT_IN:
      return evaluateMembership(rule, fieldValue, comparisonValue, false);

    case ValidationRuleOperator.CONTAINS:
      return evaluateContains(rule, fieldValue, comparisonValue, true);

    case ValidationRuleOperator.NOT_CONTAINS:
      return evaluateContains(rule, fieldValue, comparisonValue, false);

    default:
      // Every declared `ValidationRuleOperator` member is handled above. This branch only runs
      // for a stored `operator` value that doesn't match any of them (e.g. a row written/edited
      // outside the DTO-validated admin API, or a future enum member added without updating this
      // switch) — fail closed with a reason instead of falling off the end of the switch and
      // returning `undefined`, which would throw when the caller reads `.satisfied`.
      return {
        satisfied: false,
        reason: `Rule #${rule.id}: unknown operator "${String(rule.operator)}"`,
      };
  }
}

function evaluateNumericComparison(
  rule: StoredRule,
  fieldValue: unknown,
  comparisonValue: unknown,
  compare: (a: number, b: number) => boolean,
): RuleEvaluation {
  if (typeof fieldValue !== 'number' || typeof comparisonValue !== 'number') {
    const other = rule.compareField
      ? `field "${rule.compareField}"`
      : 'the stored value';

    return {
      satisfied: false,
      reason: `Rule #${rule.id}: cannot apply "${rule.operator}" — field "${rule.field}" or ${other} is not a number`,
    };
  }

  return { satisfied: compare(fieldValue, comparisonValue), reason: null };
}

function evaluateMembership(
  rule: StoredRule,
  fieldValue: unknown,
  comparisonValue: unknown,
  expectIncluded: boolean,
): RuleEvaluation {
  if (!Array.isArray(comparisonValue)) {
    const source = rule.compareField
      ? `field "${rule.compareField}"`
      : 'the stored value';

    return {
      satisfied: false,
      reason: `Rule #${rule.id}: "${rule.operator}" requires ${source} to be an array`,
    };
  }

  const included = comparisonValue.includes(fieldValue);

  return { satisfied: included === expectIncluded, reason: null };
}

function evaluateContains(
  rule: StoredRule,
  fieldValue: unknown,
  comparisonValue: unknown,
  expectContains: boolean,
): RuleEvaluation {
  let contains: boolean;

  if (Array.isArray(fieldValue)) {
    contains = fieldValue.includes(comparisonValue);
  } else if (
    typeof fieldValue === 'string' &&
    typeof comparisonValue === 'string'
  ) {
    contains = fieldValue.includes(comparisonValue);
  } else {
    return {
      satisfied: false,
      reason: `Rule #${rule.id}: "${rule.operator}" requires field "${rule.field}" to be a string or array`,
    };
  }

  return { satisfied: contains === expectContains, reason: null };
}
