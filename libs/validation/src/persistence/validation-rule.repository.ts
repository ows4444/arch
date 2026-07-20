import { BaseRepository, DatabaseRepository } from '@/database';
import { ValidationRuleEntity } from './entities/validation-rule.entity';

export interface CreateValidationRuleInput {
  readonly targetType: string;
  readonly field: string;
  readonly operator: ValidationRuleEntity['operator'];
  /** Required unless `compareField` is set — defaults to `null` (stored as JSON null). */
  readonly value?: unknown;
  readonly compareField?: string | null;
  readonly message?: string | null;
  readonly enabled?: boolean;
}

export type UpdateValidationRuleInput = Partial<
  Pick<
    ValidationRuleEntity,
    'field' | 'operator' | 'value' | 'compareField' | 'message' | 'enabled'
  >
>;

@DatabaseRepository(ValidationRuleEntity)
export class ValidationRuleRepository extends BaseRepository<ValidationRuleEntity> {
  protected readonly entity = ValidationRuleEntity;

  async findEnabledByTargetType(
    targetType: string,
  ): Promise<ValidationRuleEntity[]> {
    return this.runRead(() =>
      this.repository.find({ where: { targetType, enabled: true } }),
    );
  }

  async findAll(targetType?: string): Promise<ValidationRuleEntity[]> {
    return this.runRead(() =>
      this.repository.find({
        where: targetType ? { targetType } : {},
        order: { id: 'ASC' },
      }),
    );
  }

  async findById(id: number): Promise<ValidationRuleEntity | null> {
    return this.runRead(() => this.repository.findOneBy({ id }));
  }

  async createRule(
    input: CreateValidationRuleInput,
  ): Promise<ValidationRuleEntity> {
    return this.runWrite(() => {
      const now = new Date();
      const entity = this.repository.create({
        ...input,
        value: input.value ?? null,
        compareField: input.compareField ?? null,
        message: input.message ?? null,
        enabled: input.enabled ?? true,
        createdAt: now,
        updatedAt: now,
      });

      return this.repository.save(entity);
    });
  }

  async updateRule(
    id: number,
    patch: UpdateValidationRuleInput,
  ): Promise<ValidationRuleEntity | null> {
    return this.runWrite(async () => {
      const existing = await this.repository.findOneBy({ id });

      if (!existing) {
        return null;
      }

      // `patch` may be a class-transformer-constructed DTO where every declared optional
      // field is present as an explicit own `undefined` property (TS class-field "define"
      // semantics) — Object.assign would copy those `undefined`s over fields the caller never
      // intended to touch. Only apply keys the caller actually provided a value for.
      const definedPatch = Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined),
      );

      Object.assign(existing, definedPatch, { updatedAt: new Date() });

      return this.repository.save(existing);
    });
  }

  async deleteRule(id: number): Promise<boolean> {
    return this.runWrite(async () => {
      const result = await this.repository.delete({ id });

      return (result.affected ?? 0) > 0;
    });
  }
}
