import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateRoleDto {
  @ApiProperty({ example: 'admin' })
  @IsString()
  @MaxLength(128)
  name!: string;

  @ApiPropertyOptional({ type: [String], example: ['roles:manage'] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  permissions?: string[];
}
