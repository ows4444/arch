import { Injectable } from '@nestjs/common';
import { DatabaseRole, InjectRepository } from '@/database';
import { ValidationRuleRepository } from '../persistence/validation-rule.repository';
import type { StoredRule } from './stored-rule.interface';
import type { ValidationRuleStore } from './validation-rule-store.interface';

@Injectable()
export class DatabaseValidationRuleStore implements ValidationRuleStore {
  constructor(
    @InjectRepository(ValidationRuleRepository, DatabaseRole.READ)
    private readonly repository: ValidationRuleRepository,
  ) {}

  async findRules(targetType: string): Promise<StoredRule[]> {
    const entities = await this.repository.findEnabledByTargetType(targetType);

    return entities.map((entity) => ({
      id: entity.id,
      targetType: entity.targetType,
      field: entity.field,
      operator: entity.operator,
      value: entity.value,
      compareField: entity.compareField ?? null,
      message: entity.message ?? null,
    }));
  }

  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}
