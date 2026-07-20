import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDefined,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ValidationRuleOperator } from '@/validation';

export class UpdateValidationRuleDto {
  @ApiPropertyOptional({ example: 'name' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  field?: string;

  @ApiPropertyOptional({ enum: ValidationRuleOperator })
  @IsOptional()
  @IsEnum(ValidationRuleOperator)
  operator?: ValidationRuleOperator;

  @ApiPropertyOptional({
    description: 'Comparison value — its shape depends on the operator.',
  })
  @IsOptional()
  @IsDefined()
  value?: unknown;

  @ApiPropertyOptional({
    description:
      'When set, compares the field against another field on the same candidate instead of `value`.',
  })
  @IsOptional()
  @IsString()
  compareField?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  message?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
