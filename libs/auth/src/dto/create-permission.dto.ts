import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreatePermissionDto {
  @ApiProperty({ example: 'workflow:read' })
  @IsString()
  @MaxLength(128)
  name!: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(255)
  description?: string;
}
