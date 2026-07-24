import { Inject, Injectable, Logger } from '@nestjs/common';
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
  private readonly logger = new Logger(ValidationRuleAdminService.name);

  constructor(
    @InjectRepository(ValidationRuleRepository)
    private readonly repository: ValidationRuleRepository,
    @Inject(VALIDATION_RULE_STORE)
    private readonly store: ValidationRuleStore,
  ) {}

  /**
   * `store.invalidate` is a best-effort cache-bust, not part of this
   * operation's actual outcome — the DB write it follows has already
   * committed by the time this runs. Letting a transient cache-backend
   * failure here propagate would make a successful create/update/remove
   * look like it failed to the caller, while the write (and, for `remove`,
   * the rule's actual removal) already took effect. Logged and swallowed
   * instead; the cache falls back to its normal TTL expiry in that case.
   */
  private async invalidateStore(targetType: string): Promise<void> {
    try {
      await this.store.invalidate(targetType);
    } catch (error) {
      this.logger.warn(
        `Failed to invalidate validation rule cache for targetType='${targetType}' — ` +
          `the write already succeeded; the cache will fall back to its normal TTL expiry. ${
            error instanceof Error ? error.message : String(error)
          }`,
      );
    }
  }

  async create(
    input: CreateValidationRuleInput,
  ): Promise<ValidationRuleEntity> {
    const created = await this.repository.createRule(input);
    await this.invalidateStore(created.targetType);

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

    await this.invalidateStore(updated.targetType);

    return updated;
  }

  async remove(id: number): Promise<void> {
    const existing = await this.repository.findById(id);

    if (!existing) {
      throw new ValidationRuleNotFoundError(id);
    }

    await this.repository.deleteRule(id);
    await this.invalidateStore(existing.targetType);
  }
}
