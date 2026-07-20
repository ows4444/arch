import { DynamicModule, Global, Module, Provider } from '@nestjs/common';
import { VALIDATION_ERROR_FACTORY } from '../errors/validation-error-factory.interface';
import { DefaultValidationErrorFactory } from '../errors/default-validation-error-factory';
import { VALIDATION_RULE_STORE } from '../rules/validation-rule-store.interface';
import { NoopValidationRuleStore } from '../rules/noop-validation-rule-store';
import { DatabaseValidationRuleStore } from '../rules/database-validation-rule.store';
import { ValidationRuleService } from '../rules/validation-rule.service';
import { ValidationRuleAdminService } from '../rules/validation-rule-admin.service';
import { ValidationService } from './validation.service';
import type {
  ValidationModuleAsyncOptions,
  ValidationModuleOptions,
} from './validation.module-options.interface';

type RulesOption = ValidationModuleOptions['rules'];
type RulesAsyncOption = ValidationModuleAsyncOptions['rules'];

@Global()
@Module({})
export class ValidationModule {
  static forRoot(options: ValidationModuleOptions = {}): DynamicModule {
    return {
      module: ValidationModule,
      global: true,
      providers: [
        this.errorFactoryProvider(options.errorFactory),
        NoopValidationRuleStore,
        DatabaseValidationRuleStore,
        this.ruleStoreProvider(options.rules),
        ValidationService,
        ValidationRuleService,
        ...this.ruleAdminProviders(options.rules),
      ],
      exports: [
        VALIDATION_ERROR_FACTORY,
        VALIDATION_RULE_STORE,
        ValidationService,
        ValidationRuleService,
        ...this.ruleAdminProviders(options.rules),
      ],
    };
  }

  static forRootAsync(options: ValidationModuleAsyncOptions): DynamicModule {
    return {
      module: ValidationModule,
      global: true,
      imports: options.imports ?? [],
      providers: [
        {
          provide: VALIDATION_ERROR_FACTORY,
          useFactory: options.useFactory,
          inject: options.inject ?? [],
        },
        NoopValidationRuleStore,
        DatabaseValidationRuleStore,
        this.ruleStoreProviderAsync(options.rules),
        ValidationService,
        ValidationRuleService,
        ...this.ruleAdminProviders(options.rules),
      ],
      exports: [
        VALIDATION_ERROR_FACTORY,
        VALIDATION_RULE_STORE,
        ValidationService,
        ValidationRuleService,
        ...this.ruleAdminProviders(options.rules),
      ],
    };
  }

  private static errorFactoryProvider(
    errorFactory: ValidationModuleOptions['errorFactory'],
  ): Provider {
    return {
      provide: VALIDATION_ERROR_FACTORY,
      useClass: errorFactory ?? DefaultValidationErrorFactory,
    };
  }

  /**
   * Defaults to `NoopValidationRuleStore` (always zero rules, so `ValidationRuleService` is
   * always safe to inject) — same no-op-default-the-host-can-override convention as
   * `WORKFLOW_METRICS`/`WORKFLOW_EVENT_PUBLISHER`. `rules.enabled` swaps in the DB-backed store.
   * `useExisting` (not `useClass`) so this reuses the single `DatabaseValidationRuleStore`/
   * `NoopValidationRuleStore` instances already registered above, rather than constructing a
   * second one.
   */
  private static ruleStoreProvider(rules: RulesOption): Provider {
    return {
      provide: VALIDATION_RULE_STORE,
      useExisting: rules?.enabled
        ? DatabaseValidationRuleStore
        : NoopValidationRuleStore,
    };
  }

  /**
   * Same fallback as `ruleStoreProvider`, plus an escape hatch: `rules.useFactory` lets the host
   * supply an arbitrary `ValidationRuleStore` (e.g. `CachedValidationRuleStore` wrapping
   * `DatabaseValidationRuleStore` with an injected `CacheManager` — see ARCH.md Design 003).
   */
  private static ruleStoreProviderAsync(rules: RulesAsyncOption): Provider {
    if (rules?.useFactory) {
      return {
        provide: VALIDATION_RULE_STORE,
        useFactory: rules.useFactory,
        inject: rules.inject ?? [],
      };
    }

    return this.ruleStoreProvider(rules);
  }

  /**
   * `ValidationRuleAdminService` manages the same rows the rule store reads — providing it
   * without DB-backed rules enabled would let a caller "manage" rules that a Noop read path
   * silently ignores, so it stays tied to the same `rules.enabled` flag.
   */
  private static ruleAdminProviders(
    rules: RulesOption | RulesAsyncOption,
  ): (typeof ValidationRuleAdminService)[] {
    return rules?.enabled ? [ValidationRuleAdminService] : [];
  }
}
