import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'jane@example.com' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(128)
  password!: string;

  @ApiPropertyOptional({
    description:
      'Opaque client-generated identifier for this device — stored as forensic metadata on the issued refresh token, not validated or used for any lookup.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  deviceId?: string;
}
