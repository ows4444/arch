import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  ValidationRuleEntity,
  ValidationRuleOperator,
} from '@/validation';

export class ValidationRuleResponseDto {
  @ApiProperty()
  id!: number;

  @ApiProperty()
  targetType!: string;

  @ApiProperty()
  field!: string;

  @ApiProperty()
  operator!: ValidationRuleOperator;

  @ApiProperty()
  value!: unknown;

  @ApiPropertyOptional()
  compareField?: string | null;

  @ApiPropertyOptional()
  message?: string | null;

  @ApiProperty()
  enabled!: boolean;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  static fromEntity(entity: ValidationRuleEntity): ValidationRuleResponseDto {
    const dto = new ValidationRuleResponseDto();

    dto.id = entity.id;
    dto.targetType = entity.targetType;
    dto.field = entity.field;
    dto.operator = entity.operator;
    dto.value = entity.value;
    dto.compareField = entity.compareField ?? null;
    dto.message = entity.message ?? null;
    dto.enabled = entity.enabled;
    dto.createdAt = entity.createdAt;
    dto.updatedAt = entity.updatedAt;

    return dto;
  }
}
