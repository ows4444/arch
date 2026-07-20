import type {
  InjectionToken,
  ModuleMetadata,
  OptionalFactoryDependency,
  Type,
} from '@nestjs/common';
import type { ValidationErrorFactory } from '../errors/validation-error-factory.interface';
import type { ValidationRuleStore } from '../rules/validation-rule-store.interface';

export interface ValidationModuleOptions {
  errorFactory?: Type<ValidationErrorFactory>;
  /** Enables DB-backed stored validation rules (see ARCH.md Design 002). Off by default. */
  rules?: { enabled: boolean };
}

/**
 * `rules.useFactory`/`rules.inject` let the host supply an arbitrary `ValidationRuleStore` — e.g.
 * a `CachedValidationRuleStore` wrapping the DB-backed one with an injected `CacheManager` (see
 * ARCH.md Design 003). Falls back to the same `rules.enabled` Database/Noop choice as `forRoot`
 * when omitted.
 */
export interface ValidationModuleAsyncOptions extends Pick<
  ModuleMetadata,
  'imports'
> {
  useFactory: (
    ...args: never[]
  ) => ValidationErrorFactory | Promise<ValidationErrorFactory>;
  inject?: (InjectionToken | OptionalFactoryDependency)[];
  rules?: {
    enabled: boolean;
    useFactory?: (
      ...args: never[]
    ) => ValidationRuleStore | Promise<ValidationRuleStore>;
    inject?: (InjectionToken | OptionalFactoryDependency)[];
  };
}
