import { Injectable } from '@nestjs/common';
import type { StoredRule } from './stored-rule.interface';
import type { ValidationRuleStore } from './validation-rule-store.interface';

@Injectable()
export class NoopValidationRuleStore implements ValidationRuleStore {
  findRules(): Promise<StoredRule[]> {
    return Promise.resolve([]);
  }

  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}
