import { Inject, Injectable } from '@nestjs/common';
import { ValidationService } from '../nest/validation.service';
import { ValidationResult } from '../core/validation-result';
import { composeStoredRules } from './stored-condition.specification';
import {
  VALIDATION_RULE_STORE,
  type ValidationRuleStore,
} from './validation-rule-store.interface';

@Injectable()
export class ValidationRuleService {
  constructor(
    @Inject(VALIDATION_RULE_STORE)
    private readonly store: ValidationRuleStore,
    private readonly validationService: ValidationService,
  ) {}

  async validateStored(
    targetType: string,
    candidate: unknown,
  ): Promise<ValidationResult> {
    const rules = await this.store.findRules(targetType);
    const specification = composeStoredRules(rules);

    return this.validationService.validate(candidate, [specification]);
  }

  async validateStoredOrThrow(
    targetType: string,
    candidate: unknown,
  ): Promise<void> {
    const rules = await this.store.findRules(targetType);
    const specification = composeStoredRules(rules);

    await this.validationService.validateOrThrow(candidate, [specification]);
  }
}
