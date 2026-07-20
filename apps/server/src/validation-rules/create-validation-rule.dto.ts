import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDefined,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ValidationRuleOperator } from '@/validation';

export class CreateValidationRuleDto {
  @ApiProperty({ example: 'CreateRoleDto' })
  @IsString()
  @MaxLength(128)
  targetType!: string;

  @ApiProperty({ example: 'name' })
  @IsString()
  @MaxLength(128)
  field!: string;

  @ApiProperty({
    enum: ValidationRuleOperator,
    example: ValidationRuleOperator.NOT_EQUALS,
  })
  @IsEnum(ValidationRuleOperator)
  operator!: ValidationRuleOperator;

  @ApiPropertyOptional({
    description:
      'Comparison value — its shape depends on the operator (e.g. an array for in/not_in). Required unless `compareField` is set.',
    example: 'root',
  })
  @ValidateIf((dto: CreateValidationRuleDto) => !dto.compareField)
  @IsDefined()
  value?: unknown;

  @ApiPropertyOptional({
    description:
      'When set, compares the field against another field on the same candidate instead of `value`.',
    example: 'previousName',
  })
  @IsOptional()
  @IsString()
  compareField?: string;

  @ApiPropertyOptional({ example: 'Role name "root" is reserved' })
  @IsOptional()
  @IsString()
  message?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
