import type { Specification } from '../core/specification.interface';
import { evaluateStoredRule } from './rule-evaluator';
import type { StoredRule } from './stored-rule.interface';

export class StoredConditionSpecification implements Specification<unknown> {
  readonly name: string;

  constructor(private readonly rule: StoredRule) {
    this.name = `StoredRule#${rule.id}(${rule.field} ${rule.operator})`;
  }

  isSatisfiedBy(candidate: unknown): boolean {
    return evaluateStoredRule(candidate, this.rule).satisfied;
  }

  explain(candidate: unknown): string[] {
    const evaluation = evaluateStoredRule(candidate, this.rule);

    if (evaluation.satisfied) {
      return [];
    }

    return [evaluation.reason ?? this.rule.message ?? this.defaultMessage()];
  }

  private defaultMessage(): string {
    return `${this.rule.field} failed rule "${this.rule.operator}"`;
  }
}

class AlwaysSatisfiedSpecification implements Specification<unknown> {
  readonly name = 'AlwaysSatisfied';

  isSatisfiedBy(): boolean {
    return true;
  }

  explain(): string[] {
    return [];
  }
}

/**
 * Composes stored rules into a single `Specification` via AND, so they slot into
 * `ValidationService.validate` alongside code-defined specifications. An empty rule set is
 * trivially satisfied (no configured rules means nothing to fail against).
 */
export function composeStoredRules(
  rules: readonly StoredRule[],
): Specification<unknown> {
  if (rules.length === 0) {
    return new AlwaysSatisfiedSpecification();
  }

  return {
    name: `StoredRules(${rules.map((rule) => rule.id).join(',')})`,
    isSatisfiedBy: (candidate: unknown) =>
      rules.every((rule) =>
        new StoredConditionSpecification(rule).isSatisfiedBy(candidate),
      ),
    explain: (candidate: unknown) =>
      rules.flatMap((rule) =>
        new StoredConditionSpecification(rule).explain(candidate),
      ),
  };
}
