import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class VerifyMfaDto {
  @ApiProperty({ description: 'challengeToken from the login response.' })
  @IsString()
  @MaxLength(256)
  challengeToken!: string;

  @ApiProperty({ description: 'A 6-digit TOTP code, or a recovery code.' })
  @IsString()
  @MaxLength(64)
  code!: string;

  @ApiPropertyOptional({
    description:
      'Opaque client-generated identifier for this device — see LoginDto.deviceId.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  deviceId?: string;
}
