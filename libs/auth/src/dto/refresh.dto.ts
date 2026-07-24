import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RefreshDto {
  @ApiProperty()
  @IsString()
  @MaxLength(512)
  refreshToken!: string;

  @ApiPropertyOptional({
    description:
      'Opaque client-generated identifier for this device — stored as forensic metadata on the newly-issued refresh token, not validated or used for any lookup.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  deviceId?: string;
}
