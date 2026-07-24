import { ApiProperty } from '@nestjs/swagger';

export class MfaEnrollResponseDto {
  @ApiProperty({
    description:
      'Raw TOTP secret, for manual entry as a fallback to scanning the QR code.',
  })
  secret!: string;

  @ApiProperty({
    description:
      'otpauth:// URI — render as a QR code for an authenticator app to scan.',
  })
  otpauthUrl!: string;
}
