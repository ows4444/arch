import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@/database';
import { ValidationRuleEntity } from '../persistence/entities/validation-rule.entity';
import { ValidationRuleNotFoundError } from '../errors/validation-rule-not-found.error';
import {
  CreateValidationRuleInput,
  UpdateValidationRuleInput,
  ValidationRuleRepository,
} from '../persistence/validation-rule.repository';
import {
  VALIDATION_RULE_STORE,
  type ValidationRuleStore,
} from './validation-rule-store.interface';

/**
 * Thin CRUD orchestration over `ValidationRuleRepository` — kept separate from
 * `ValidationRuleService` (which only *reads* enabled rules to validate a candidate) so read-path
 * consumers never need write-path dependencies. Framework/transport-agnostic: HTTP DTOs and
 * authorization stay in the consuming app (see apps/server's `ValidationRuleController`).
 *
 * Depends on `VALIDATION_RULE_STORE` in addition to the repository solely to call
 * `invalidate(targetType)` after a write — see ARCH.md Design 004.
 */
@Injectable()
export class ValidationRuleAdminService {
  constructor(
    @InjectRepository(ValidationRuleRepository)
    private readonly repository: ValidationRuleRepository,
    @Inject(VALIDATION_RULE_STORE)
    private readonly store: ValidationRuleStore,
  ) {}

  async create(
    input: CreateValidationRuleInput,
  ): Promise<ValidationRuleEntity> {
    const created = await this.repository.createRule(input);
    await this.store.invalidate(created.targetType);

    return created;
  }

  list(targetType?: string): Promise<ValidationRuleEntity[]> {
    return this.repository.findAll(targetType);
  }

  async findOne(id: number): Promise<ValidationRuleEntity> {
    const rule = await this.repository.findById(id);

    if (!rule) {
      throw new ValidationRuleNotFoundError(id);
    }

    return rule;
  }

  async update(
    id: number,
    patch: UpdateValidationRuleInput,
  ): Promise<ValidationRuleEntity> {
    const updated = await this.repository.updateRule(id, patch);

    if (!updated) {
      throw new ValidationRuleNotFoundError(id);
    }

    await this.store.invalidate(updated.targetType);

    return updated;
  }

  async remove(id: number): Promise<void> {
    const existing = await this.repository.findById(id);

    if (!existing) {
      throw new ValidationRuleNotFoundError(id);
    }

    await this.repository.deleteRule(id);
    await this.store.invalidate(existing.targetType);
  }
}
