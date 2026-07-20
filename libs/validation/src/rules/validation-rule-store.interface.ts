import type { StoredRule } from './stored-rule.interface';

/**
 * Port for loading stored validation rules. Injected via `VALIDATION_RULE_STORE` so
 * `libs/validation`'s core evaluation logic never depends directly on how rules are persisted.
 */
export interface ValidationRuleStore {
  findRules(targetType: string): Promise<StoredRule[]>;

  /**
   * Called by `ValidationRuleAdminService` after a rule for `targetType` is created, updated, or
   * deleted. A no-op for stores with nothing to invalidate (e.g. `NoopValidationRuleStore`,
   * `DatabaseValidationRuleStore` — reads are always fresh); `CachedValidationRuleStore` busts
   * its cached entry so writes are visible on the next `findRules` call rather than waiting out
   * the TTL. See ARCH.md Design 004.
   */
  invalidate(targetType: string): Promise<void>;
}

export const VALIDATION_RULE_STORE = Symbol('VALIDATION_RULE_STORE');
