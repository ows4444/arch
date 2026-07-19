import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PermissionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional()
  description?: string | null;
}
