import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { ValidationRuleOperator } from '../../rules/validation-rule-operator.enum';

@Index(['targetType', 'enabled'])
@Entity('validation_rule')
export class ValidationRuleEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  targetType!: string;

  @Column()
  field!: string;

  @Column({ type: 'varchar' })
  operator!: ValidationRuleOperator;

  /** Nullable because a cross-field rule (`compareField` set) doesn't need a literal value. */
  @Column({ type: 'json', nullable: true })
  value?: unknown;

  /**
   * When set, evaluation compares `candidate[field]` against `candidate[compareField]` instead
   * of the stored `value` literal, for every operator — see ARCH.md Design 005/006.
   */
  @Column({ type: 'varchar', nullable: true })
  compareField?: string | null;

  @Column({ type: 'text', nullable: true })
  message?: string | null;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @Column({ type: 'datetime' })
  createdAt!: Date;

  @Column({ type: 'datetime' })
  updatedAt!: Date;
}
